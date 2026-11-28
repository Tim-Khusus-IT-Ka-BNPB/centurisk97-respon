import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Started = { at: number; until: number };
const tones: Started[] = [];
const made: FakeAudio[] = [];
class FakeAudio {
  constructor() {
    made.push(this);
  }
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
  made.length = 0;
  shown.length = 0;
  FakeNotification.permission = "default";
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("AudioContext", FakeAudio);
  vi.stubGlobal("Notification", FakeNotification);
});
afterEach(() => vi.unstubAllGlobals());

describe("the desk's alarm", () => {
  test("is silent until the officer turns it on, then sounds three tones and may notify", async () => {
    const { alarmState, alarmSound, askForAlarm, notificationsBlocked, notify, onAlarmChange } = await load();
    const heard = vi.fn();
    onAlarmChange(heard);
    expect(alarmState()).toBe("off");
    alarmSound();
    notify("Laporan darurat baru", "A, B", "/desk/LA-1");
    expect([tones.length, shown.length]).toEqual([0, 0]);
    await askForAlarm();
    expect(tones).toHaveLength(3);
    expect(tones[0]).toEqual({ at: 10, until: 10.22 });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect([alarmState(), notificationsBlocked(), heard.mock.calls.length]).toEqual(["on", false, 1]);
  });

  test("asks for notifications once, and not again when they were answered", async () => {
    FakeNotification.permission = "denied";
    const { alarmState, askForAlarm, notificationsBlocked, onAlarmChange } = await load();
    const heard = vi.fn();
    onAlarmChange(heard)();
    await askForAlarm();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    // The sound is on all the same; a listener that stopped hears nothing.
    expect([alarmState(), notificationsBlocked(), heard.mock.calls.length]).toEqual(["on", true, 0]);
  });

  test("after a reload notifications still come, and the first click or key lets the sound through", async () => {
    FakeNotification.permission = "granted";
    const { alarmState, onAlarmChange, wakeOnGesture } = await load();
    const heard = vi.fn();
    onAlarmChange(heard);
    expect(alarmState()).toBe("asleep");
    wakeOnGesture();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await vi.waitFor(() => expect(alarmState()).toBe("on"));
    expect([made.length, made[0]?.resume.mock.calls.length, heard.mock.calls.length]).toEqual([1, 1, 1]);
    // Once through, no other click asks again.
    document.dispatchEvent(new MouseEvent("click"));
    await Promise.resolve();
    expect([made.length, made[0]?.resume.mock.calls.length, heard.mock.calls.length]).toEqual([1, 1, 1]);
  });

  test("never turned on, or left before a click, nothing wakes it", async () => {
    const { alarmState, wakeOnGesture } = await load();
    wakeOnGesture();
    document.dispatchEvent(new MouseEvent("click"));
    expect([alarmState(), made.length]).toEqual(["off", 0]);
    FakeNotification.permission = "granted";
    wakeOnGesture()();
    document.dispatchEvent(new MouseEvent("click"));
    await Promise.resolve();
    expect([alarmState(), made.length]).toEqual(["asleep", 0]);
  });

  test("a browser with notifications and no sound is on as soon as they are allowed", async () => {
    vi.stubGlobal("AudioContext", undefined);
    FakeNotification.permission = "granted";
    const { alarmState, wakeOnGesture } = await load();
    expect(alarmState()).toBe("on");
    wakeOnGesture();
    document.dispatchEvent(new MouseEvent("click"));
    expect(alarmState()).toBe("on");
  });

  test("a notification names the place and opens its report", async () => {
    FakeNotification.permission = "granted";
    const focus = vi.spyOn(window, "focus").mockReturnValue(undefined);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const { notify } = await load();
    notify("Laporan darurat baru", "Cot Seumiyong, Aceh Utara", "/desk/LA-1");
    expect(shown[0]).toMatchObject({ title: "Laporan darurat baru", options: { body: "Cot Seumiyong, Aceh Utara" } });
    shown[0]?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/desk/LA-1");
    focus.mockRestore();
  });

  test("a browser with neither sound nor notifications has no alarm and stays quiet", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("Notification", undefined);
    const { alarmState, alarmSound, askForAlarm, notificationsBlocked, notify } = await load();
    await askForAlarm();
    alarmSound();
    notify("a", "b", "/c");
    expect([alarmState(), notificationsBlocked()]).toEqual(["none", false]);
    expect([tones.length, shown.length]).toEqual([0, 0]);
  });
});
