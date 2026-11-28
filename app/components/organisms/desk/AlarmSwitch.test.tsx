import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AlarmState } from "../../../lib/alarm";
import { TextContext } from "../../../lib/text";
import { renderDesk, SUMMARY } from "../../../testing/desk";
import { text } from "../../../testing/render";

const alarm = vi.hoisted(() => ({
  state: "off" as AlarmState,
  blocked: false,
  listeners: new Set<() => void>(),
  ask: vi.fn(async () => undefined),
  wake: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("../../../lib/alarm", () => ({
  alarmState: () => alarm.state,
  notificationsBlocked: () => alarm.blocked,
  onAlarmChange: (listener: () => void) => {
    alarm.listeners.add(listener);
    return () => alarm.listeners.delete(listener);
  },
  askForAlarm: alarm.ask,
  wakeOnGesture: () => {
    alarm.wake();
    return alarm.stop;
  },
}));

import { AlarmSwitch } from "./AlarmSwitch";
import { DeskResponseView } from "./DeskResponse";

const draw = () =>
  render(
    <TextContext.Provider value={text}>
      <AlarmSwitch />
    </TextContext.Provider>,
  );
const becomes = (state: AlarmState) =>
  act(() => {
    alarm.state = state;
    for (const listener of alarm.listeners) listener();
  });

beforeEach(() => {
  alarm.state = "off";
  alarm.blocked = false;
  for (const one of [alarm.ask, alarm.wake, alarm.stop]) one.mockClear();
});

describe("the emergency alarm in the desk's menu", () => {
  test("is turned on before any emergency comes, then says it is on", () => {
    draw();
    const button = screen.getByRole("button", { name: /Nyalakan alarm darurat/ });
    expect(button.textContent).toContain("selama meja ini terbuka");
    fireEvent.click(button);
    expect(alarm.ask).toHaveBeenCalledTimes(1);
    becomes("on");
    expect(screen.getByRole("status").textContent).toBe("Alarm darurat menyala");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("after a reload asks for one click to bring the sound back, and says notifications still come", () => {
    alarm.state = "asleep";
    const view = draw();
    expect(alarm.wake).toHaveBeenCalledTimes(1);
    const button = screen.getByRole("button", { name: /Nyalakan lagi suara alarm/ });
    expect(button.textContent).toContain("Notifikasi tetap menyala");
    fireEvent.click(button);
    expect(alarm.ask).toHaveBeenCalledTimes(1);
    view.unmount();
    expect([alarm.stop.mock.calls.length, alarm.listeners.size]).toEqual([1, 0]);
  });

  test("on with notifications blocked, says only the sound is left", () => {
    alarm.state = "on";
    alarm.blocked = true;
    draw();
    expect(screen.getByRole("status").textContent).toContain("Notifikasi diblokir browser");
  });

  test("where the browser has neither, or before script, there is nothing to turn on", () => {
    alarm.state = "none";
    const view = draw();
    expect(view.container.innerHTML).toBe("");
    alarm.state = "off";
    const served = renderToString(
      <TextContext.Provider value={text}>
        <AlarmSwitch />
      </TextContext.Provider>,
    );
    expect(served).toBe("");
  });

  test("stands in the menu beside the work and behind the phone's menu button", async () => {
    await renderDesk(
      <DeskResponseView
        response={{ account: { label: "Pusdalops BNPB, Petugas Uji" }, month: "2026-11", agencies: [] }}
        summary={SUMMARY}
        warnings={null}
      />,
      { path: "/desk/response" },
    );
    expect(screen.getAllByRole("button", { name: /Nyalakan alarm darurat/ })).toHaveLength(2);
  });
});
