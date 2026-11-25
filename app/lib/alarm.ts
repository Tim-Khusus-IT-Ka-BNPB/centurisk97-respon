// The desk's alarm in the browser: a sound and a notification. Both need the officer's own click
// first, and each is left out where the browser has none.

let context: AudioContext | null = null;

const audio = (): AudioContext | null => {
  if (context === null && typeof AudioContext !== "undefined") context = new AudioContext();
  return context;
};

const mayNotify = () => typeof Notification !== "undefined" && Notification.permission === "granted";

// Turned on before in this browser: notifications stay granted, and sound follows the next click.
export const alarmReady = (): boolean => mayNotify();

// The officer turned the alarm on: sound is let through, and notifications are asked for once.
export async function askForAlarm(): Promise<boolean> {
  await audio()?.resume();
  alarmSound();
  if (typeof Notification === "undefined") return true;
  if (Notification.permission === "default") await Notification.requestPermission();
  return true;
}

const BEEPS = [0, 0.35, 0.7] as const;

// Three short tones; silence until the browser lets sound through.
export function alarmSound(): void {
  const sound = audio();
  if (sound === null || sound.state !== "running") return;
  for (const start of BEEPS) {
    const tone = sound.createOscillator();
    const volume = sound.createGain();
    tone.frequency.value = 880;
    volume.gain.value = 0.2;
    tone.connect(volume).connect(sound.destination);
    tone.start(sound.currentTime + start);
    tone.stop(sound.currentTime + start + 0.22);
  }
}

// A notification that opens the report; nothing of the reporter is in it.
export function notify(title: string, body: string, address: string): void {
  if (!mayNotify()) return;
  const shown = new Notification(title, { body, tag: address });
  shown.onclick = () => {
    window.focus();
    window.location.assign(address);
  };
}
