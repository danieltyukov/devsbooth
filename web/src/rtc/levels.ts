import { useSyncExternalStore } from 'react';

/** Audio level above which someone counts as speaking (about -34 dBov). */
export const SPEAKING_LEVEL = 0.02;
/** How long "speaking" lingers after the level drops, so the indicator does not flicker between words. */
const SPEAKING_HOLD_MS = 450;

interface Entry {
  level: number;
  speakingUntil: number;
  /** Whether the peer counted as speaking at the last update; the hold expires with time, not input. */
  speaking: boolean;
}

/**
 * Per-participant audio levels, updated about ten times a second. Kept outside React state
 * so a level change only re-renders the meter that shows it.
 */
export class LevelStore {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<() => void>>();

  set(peerId: string, level: number, now = performance.now()): void {
    const previous = this.entries.get(peerId);
    const speakingUntil = level >= SPEAKING_LEVEL ? now + SPEAKING_HOLD_MS : (previous?.speakingUntil ?? 0);
    const next = { level, speakingUntil, speaking: speakingUntil > now };
    const changed =
      !previous || Math.abs(previous.level - level) > 0.002 || previous.speaking !== next.speaking;
    this.entries.set(peerId, next);
    if (changed) this.listeners.get(peerId)?.forEach((listener) => listener());
  }

  level(peerId: string): number {
    return this.entries.get(peerId)?.level ?? 0;
  }

  speaking(peerId: string): boolean {
    return this.entries.get(peerId)?.speaking ?? false;
  }

  delete(peerId: string): void {
    this.entries.delete(peerId);
  }

  subscribe(peerId: string, listener: () => void): () => void {
    let set = this.listeners.get(peerId);
    if (!set) {
      set = new Set();
      this.listeners.set(peerId, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }
}

export function useLevel(store: LevelStore, peerId: string): { level: number; speaking: boolean } {
  const level = useSyncExternalStore(
    (listener) => store.subscribe(peerId, listener),
    () => store.level(peerId),
  );
  const speaking = useSyncExternalStore(
    (listener) => store.subscribe(peerId, listener),
    () => store.speaking(peerId),
  );
  return { level, speaking };
}

/** Maps a linear audio level (0..1) onto lit meter segments on a 48 dB scale. */
export function litSegments(level: number, segments: number): number {
  if (level <= 0) return 0;
  const db = 20 * Math.log10(level);
  const fraction = (db + 48) / 48;
  return Math.max(0, Math.min(segments, Math.round(fraction * segments)));
}

/** Measures the local microphone with an AnalyserNode. */
export class LocalMeter {
  private readonly context: AudioContext;
  private readonly analyser: AnalyserNode;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly buffer: Float32Array<ArrayBuffer>;

  constructor(stream: MediaStream) {
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
  }

  /** Browsers start audio contexts suspended until a user gesture. */
  resume(): void {
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  read(): number {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (const sample of this.buffer) sum += sample * sample;
    // RMS, scaled up a little so normal speech sits in the same range as remote audioLevel.
    return Math.min(1, Math.sqrt(sum / this.buffer.length) * 2);
  }

  close(): void {
    this.source.disconnect();
    void this.context.close().catch(() => {});
  }
}
