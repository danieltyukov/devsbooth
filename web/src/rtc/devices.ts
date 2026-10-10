import { useEffect, useState } from 'react';

export interface AudioInput {
  deviceId: string;
  label: string;
}

/** Microphones the browser can see. Labels appear once microphone access has been granted. */
export function useAudioInputs(enabled: boolean): AudioInput[] {
  const [inputs, setInputs] = useState<AudioInput[]>([]);

  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!enabled || !devices?.enumerateDevices) return;
    let active = true;
    const refresh = async () => {
      const all = await devices.enumerateDevices().catch(() => []);
      if (!active) return;
      setInputs(
        all
          .filter((device) => device.kind === 'audioinput' && device.deviceId)
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
          })),
      );
    };
    void refresh();
    devices.addEventListener('devicechange', refresh);
    return () => {
      active = false;
      devices.removeEventListener('devicechange', refresh);
    };
  }, [enabled]);

  return inputs;
}
