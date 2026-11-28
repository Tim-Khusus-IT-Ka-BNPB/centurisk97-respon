// The desk's alarm in the browser: a sound and a notification. Both need the officer's own click
// first, and each is left out where the browser has none. The browser keeps notifications allowed
// across reloads, but lets sound through again only after a click on each new page.

let context: AudioContext | null = null;

const audio = (): AudioContext | null => {
  if (context === null && typeof AudioContext !== "undefined") context = new AudioContext();
  return context;
};

const mayNotify = () => typeof Notification !== "undefined" && Notification.permission === "granted";

const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

// Told each time the alarm's state may have changed; the returned function stops it.
export function onAlarmChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// none: the browser has neither sound nor notifications. off: not turned on in this browser.
// asleep: turned on before, so notifications still come, but this page has no sound until a click.
// on: sound is let through on this page.
export type AlarmState = "none" | "off" | "asleep" | "on";

export function alarmState(): AlarmState {
  const sound = typeof AudioContext !== "undefined";
  if (!sound && typeof Notification === "undefined") return "none";
  if (context?.state === "running") return "on";
  if (mayNotify()) return sound ? "asleep" : "on";
  return "off";
}

// The browser refused notifications, so only the sound is left.
export const notificationsBlocked = (): boolean =>
  typeof Notification !== "undefined" && Notification.permission === "denied";

// The officer turned the alarm on: sound is let through, and notifications are asked for once.
export async function askForAlarm(): Promise<void> {
  await audio()?.resume();
  alarmSound();
  if (typeof Notification !== "undefined" && Notification.permission === "default")
    await Notification.requestPermission();
  changed();
}

const GESTURES = ["click", "keydown"] as const;

// After a reload, the officer's first click or key anywhere on the page lets the sound through
// again, as the browser allows. Nothing is listened for when the alarm was never turned on.
export function wakeOnGesture(): () => void {
  const stop = () => {
    for (const name of GESTURES) document.removeEventListener(name, wake);
  };
  const wake = async () => {
    stop();
    await audio()?.resume();
    changed();
  };
  if (alarmState() === "asleep") for (const name of GESTURES) document.addEventListener(name, wake);
  return stop;
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
