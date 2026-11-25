import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DeskEmergency } from "../../../../src/contract/desk";
import { TextContext } from "../../../lib/text";
import { renderDesk, SENT } from "../../../testing/desk";
import { text } from "../../../testing/render";

const alarm = vi.hoisted(() => ({ ready: false, sound: vi.fn(), notify: vi.fn(), ask: vi.fn(async () => true) }));
vi.mock("../../../lib/alarm", () => ({
  alarmReady: () => alarm.ready,
  alarmSound: alarm.sound,
  notify: alarm.notify,
  askForAlarm: alarm.ask,
}));

import { EmergencyBanner } from "./EmergencyBanner";

const FIRST: DeskEmergency = {
  ticketNumber: "LA-241126-01",
  kind: "chat",
  victims: "yes",
  hazardType: "flood",
  villageName: "Cot Seumiyong",
  regencyName: "Aceh Utara",
  sentAt: SENT,
};
const SECOND: DeskEmergency = {
  ...FIRST,
  ticketNumber: "LA-241126-02",
  kind: "oneTap",
  victims: "unknown",
  hazardType: "other",
};
const answer = (response: () => Response | Promise<Response>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
const draw = (initial: DeskEmergency[]) => renderDesk(<EmergencyBanner initial={initial} />, { path: "/lapor/meja" });
const links = () => screen.queryAllByRole("link").map((link) => link.getAttribute("href"));
const later = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  alarm.ready = false;
  for (const one of [alarm.sound, alarm.notify, alarm.ask]) one.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the desk's emergencies", () => {
  test("stand on top with their place, time and victims, each leading to its report", async () => {
    await draw([SECOND, FIRST]);
    expect(screen.getByRole("alert").textContent).toBe("2 laporan darurat belum dibuka");
    expect(links()).toEqual(["/lapor/meja/LA-241126-02", "/lapor/meja/LA-241126-01"]);
    const [tap, chat] = screen.getAllByRole("link") as [HTMLElement, HTMLElement];
    expect(within(tap).getByText(/Jenis belum diketahui, Cot Seumiyong, Aceh Utara/)).toBeTruthy();
    expect(tap.textContent).toContain("korban belum diketahui");
    expect(within(chat).getByText(/Banjir, Cot Seumiyong, Aceh Utara/)).toBeTruthy();
    expect(chat.textContent).toContain("24 Nov 2026, 09.30 WIB, ada korban");
    // What was there when the page opened was not news.
    expect(alarm.sound).not.toHaveBeenCalled();
  });

  test("a new one within 20 seconds sounds and notifies once, with nothing of the reporter in it", async () => {
    answer(() => Response.json({ emergencies: [SECOND, FIRST] }));
    await draw([FIRST]);
    await later(20_000);
    expect(links()).toHaveLength(2);
    expect(alarm.sound).toHaveBeenCalledTimes(1);
    expect(alarm.notify.mock.calls).toEqual([
      ["Laporan darurat baru", "Cot Seumiyong, Aceh Utara", "/lapor/meja/LA-241126-02"],
    ]);
    await later(20_000);
    expect(alarm.sound).toHaveBeenCalledTimes(1);
  });

  test("go once opened; none leaves no banner", async () => {
    answer(() => Response.json({ emergencies: [] }));
    await draw([FIRST]);
    await later(20_000);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(alarm.sound).not.toHaveBeenCalled();
  });

  test("a refused or lost read keeps what was there", async () => {
    answer(() => new Response(null, { status: 429 }));
    await draw([FIRST]);
    await later(20_000);
    expect(links()).toHaveLength(1);
    answer(() => {
      throw new TypeError("offline");
    });
    await later(20_000);
    expect(links()).toHaveLength(1);
  });

  test("a read that arrives after the page closed draws nothing", async () => {
    let finish: (response: Response) => void = () => {};
    answer(() => new Promise<Response>((resolve) => (finish = resolve)));
    const view = await draw([FIRST]);
    await later(20_000);
    view.unmount();
    finish(Response.json({ emergencies: [SECOND] }));
    await later(10);
    expect(alarm.sound).not.toHaveBeenCalled();
  });

  test("the officer turns sound and notifications on once; where they are on there is no button", async () => {
    const view = await draw([FIRST]);
    fireEvent.click(screen.getByRole("button", { name: "Nyalakan suara dan notifikasi" }));
    await later(10);
    expect(alarm.ask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button")).toBeNull();
    view.unmount();
    alarm.ready = true;
    await draw([FIRST]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("with no script they are still there, with no button", () => {
    const Stub = createRoutesStub([{ path: "/", Component: Served }]);
    const page = document.createElement("div");
    page.innerHTML = renderToString(<Stub />);
    expect(page.querySelectorAll("a")).toHaveLength(1);
    expect(page.querySelector("button")).toBeNull();
  });
});

function Served() {
  return (
    <TextContext.Provider value={text}>
      <EmergencyBanner initial={[FIRST]} />
    </TextContext.Provider>
  );
}
