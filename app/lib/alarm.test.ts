import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Started = { at: number; until: number };
const tones: Started[] = [];
class FakeAudio {
  state = "suspended";
  currentTime = 10;
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createOscillator() {
    const tone = { at: 0, until: 0 };
    return {
      frequency: { value: 0 },
      connect: (next: unknown) => next,
      start: (at: number) => {
        tone.at = at;
        tones.push(tone);
      },
      stop: (until: number) => {
        tone.until = until;
      },
    };
  }
  createGain() {
    return { gain: { value: 0 }, connect: (next: unknown) => next };
  }
}
const shown: { title: string; options: NotificationOptions; onclick: (() => void) | null }[] = [];
class FakeNotification {
  static permission = "default";
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = "granted";
    return "granted";
  });
  onclick: (() => void) | null = null;
  constructor(title: string, options: NotificationOptions) {
    shown.push(Object.assign(this, { title, options }));
  }
}

const load = async () => import("./alarm");

beforeEach(() => {
  vi.resetModules();
  tones.length = 0;
  shown.length = 0;
  FakeNotification.permission = "default";
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("AudioContext", FakeAudio);
  vi.stubGlobal("Notification", FakeNotification);
});
afterEach(() => vi.unstubAllGlobals());

describe("the desk's alarm", () => {
  test("is silent until the officer turns it on, then sounds three tones and may notify", async () => {
    const { alarmReady, alarmSound, askForAlarm, notify } = await load();
    expect(alarmReady()).toBe(false);
    alarmSound();
    notify("Laporan darurat baru", "A, B", "/lapor/meja/LA-1");
    expect([tones.length, shown.length]).toEqual([0, 0]);
    expect(await askForAlarm()).toBe(true);
    expect(tones).toHaveLength(3);
    expect(tones[0]).toEqual({ at: 10, until: 10.22 });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(alarmReady()).toBe(true);
  });

  test("asks for notifications once, and not again when they were answered", async () => {
    FakeNotification.permission = "denied";
    const { alarmReady, askForAlarm } = await load();
    await askForAlarm();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(alarmReady()).toBe(false);
  });

  test("a notification names the place and opens its report", async () => {
    FakeNotification.permission = "granted";
    const focus = vi.spyOn(window, "focus").mockReturnValue(undefined);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const { notify } = await load();
    notify("Laporan darurat baru", "Cot Seumiyong, Aceh Utara", "/lapor/meja/LA-1");
    expect(shown[0]).toMatchObject({ title: "Laporan darurat baru", options: { body: "Cot Seumiyong, Aceh Utara" } });
    shown[0]?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/lapor/meja/LA-1");
    focus.mockRestore();
  });

  test("a browser with neither sound nor notifications takes it as on and stays quiet", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("Notification", undefined);
    const { alarmReady, alarmSound, askForAlarm, notify } = await load();
    expect(await askForAlarm()).toBe(true);
    alarmSound();
    notify("a", "b", "/c");
    expect(alarmReady()).toBe(false);
    expect([tones.length, shown.length]).toEqual([0, 0]);
  });
});
