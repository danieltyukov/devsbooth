import { describe, expect, it, vi } from 'vitest';
import { LevelStore, litSegments, SPEAKING_LEVEL } from './levels';

describe('LevelStore', () => {
  it('holds speaking briefly after the level drops, then lets go and notifies', () => {
    const store = new LevelStore();
    const listener = vi.fn();
    store.subscribe('a', listener);

    store.set('a', 0.5, 1_000);
    expect(store.speaking('a')).toBe(true);
    store.set('a', 0, 1_100);
    expect(store.speaking('a')).toBe(true);

    listener.mockClear();
    store.set('a', 0, 2_000);
    expect(store.speaking('a')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    // Nothing changes, so nobody re-renders.
    listener.mockClear();
    store.set('a', 0, 2_100);
    expect(listener).not.toHaveBeenCalled();
  });

  it('treats quiet levels as silence', () => {
    const store = new LevelStore();
    store.set('a', SPEAKING_LEVEL / 2, 0);
    expect(store.speaking('a')).toBe(false);
  });
});

describe('litSegments', () => {
  it('maps levels onto a 48 dB scale', () => {
    expect(litSegments(0, 10)).toBe(0);
    expect(litSegments(1, 10)).toBe(10);
    expect(litSegments(0.1, 10)).toBe(6);
    expect(litSegments(0.001, 10)).toBe(0);
  });
});
