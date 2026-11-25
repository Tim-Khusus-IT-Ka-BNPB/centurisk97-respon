import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import type { DeskPilot } from "../../../../src/contract/desk";
import { renderDesk, SENT, SUMMARY } from "../../../testing/desk";
import { never } from "../../../testing/render";
import { DeskPilotView } from "./DeskPilot";

const PATH = { path: "/lapor/meja/pilot" };
const PILOT: DeskPilot = {
  account: { label: "Pusdalops BNPB, Petugas Uji" },
  max: 500,
  items: [
    {
      key: "a".repeat(64),
      number: "+6280000000101",
      officerRegency: "Kabupaten Uji",
      addedBy: "Pusdalops BNPB, Petugas Uji",
      addedAt: SENT,
      reports: 3,
      lastReportAt: SENT,
    },
    {
      key: "b".repeat(64),
      number: "+6280000000102",
      officerRegency: null,
      addedBy: "mac-mini",
      addedAt: SENT,
      reports: 0,
      lastReportAt: null,
    },
  ],
};
type Props = Partial<Parameters<typeof DeskPilotView>[0]>;
const draw = (props: Props = {}, options: object = {}) =>
  renderDesk(<DeskPilotView pilot={PILOT} summary={SUMMARY} {...props} />, { ...PATH, ...options });

describe("the numbers of the WhatsApp pilot", () => {
  test("each number, as whose, who allowed it and what it sent", async () => {
    await draw();
    expect(screen.getByRole("heading", { level: 1, name: "Nomor uji WhatsApp" })).toBeTruthy();
    expect(screen.getByText("2 dari 500 nomor")).toBeTruthy();
    const rows = within(screen.getByRole("region", { name: "Nomor yang diizinkan" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("+62 800-0000-0101BPBD Kabupaten Uji");
    expect(rows[0]?.textContent).toContain("Diizinkan Pusdalops BNPB, Petugas Uji24 Nov 2026, 09.30 WIB");
    expect(rows[0]?.textContent).toContain("3 laporanterakhir 24 Nov 2026");
    expect(rows[1]?.textContent).toContain("Warga");
    expect(rows[1]?.textContent).toContain("Belum melapor");
    const links = screen.getAllByRole("link", { name: "Nomor uji WhatsApp" });
    expect(links.map((link) => link.getAttribute("aria-current"))).toContain("page");
  });

  test("an empty list says what that means", async () => {
    await draw({ pilot: { ...PILOT, items: [] } });
    expect(screen.getByText(/Selama daftar ini kosong, WhatsApp tidak melayani siapa pun/)).toBeTruthy();
    expect(screen.getByText("0 dari 500 nomor")).toBeTruthy();
  });

  test("taking one away says what stops, then posts that number", async () => {
    await draw({}, { action: never });
    const fold = screen.getByLabelText("Cabut izin +62 800-0000-0102").closest("details") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    fireEvent.click(screen.getByLabelText("Cabut izin +62 800-0000-0102"));
    expect(within(fold).getByText(/tidak dilayani lagi di WhatsApp/)).toBeTruthy();
    const button = within(fold).getByRole("button", { name: "Cabut izin" }) as HTMLButtonElement;
    const form = new FormData(button.form as HTMLFormElement);
    expect([form.get("action"), form.get("key")]).toEqual(["remove", "b".repeat(64)]);
    fireEvent.click(button);
    expect(await within(fold).findByRole("button", { name: "Mencabut..." })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Izinkan nomor" })).toHaveLength(1);
  });

  test("a number is added, and says so while on its way", async () => {
    await draw({}, { action: never });
    const add = within(screen.getByRole("region", { name: "Izinkan nomor" }));
    fireEvent.change(add.getByLabelText("Nomor WhatsApp"), { target: { value: "0800 0000 0103" } });
    fireEvent.click(add.getByRole("button", { name: "Izinkan nomor" }));
    expect(await add.findByRole("button", { name: "Menyimpan..." })).toBeTruthy();
  });

  test("a refused number keeps what was typed, names the fix and takes the focus", async () => {
    await draw({
      envelope: {
        ...envelope("request.invalidFields"),
        fields: [{ fieldId: "officerRegency", copyKey: "fieldError.officerRegency.tooShort", params: {} }],
      },
      typed: { values: { number: "0800 0000 0103", officerRegency: "ab" }, actions: [] },
    });
    const regency = screen.getByLabelText("BPBD kabupaten atau kota") as HTMLInputElement;
    expect([regency.value, regency.getAttribute("aria-invalid")]).toEqual(["ab", "true"]);
    expect((screen.getByLabelText("Nomor WhatsApp") as HTMLInputElement).value).toBe("0800 0000 0103");
    await waitFor(() => expect(document.activeElement).toBe(regency));
  });

  test("what was done is said; a refusal of no field is told in its place", async () => {
    const view = await draw({}, { entry: "/lapor/meja/pilot?saved=allowed" });
    expect(screen.getByRole("status").textContent).toContain("Nomor sudah diizinkan.");
    view?.unmount?.();
    const other = await draw({}, { entry: "/lapor/meja/pilot?saved=entah" });
    expect(screen.queryByText("Nomor sudah diizinkan.")).toBeNull();
    other?.unmount?.();
    const removed = await draw({}, { entry: "/lapor/meja/pilot?saved=removed" });
    expect(screen.getByText("Izin nomor sudah dicabut.")).toBeTruthy();
    removed?.unmount?.();
    const retryAt = { utc: "2026-11-24T03:00:00.000Z", zone: "WIB" as const };
    const limited = await draw(
      { envelope: envelope("limit.desk.write", { params: { limit: 120 }, retryAt }) },
      { entry: "/lapor/meja/pilot?saved=allowed" },
    );
    expect(screen.getByText(/Batas tindakan meja tercapai/)).toBeTruthy();
    expect(screen.queryByText("Nomor sudah diizinkan.")).toBeNull();
    limited?.unmount?.();
    await draw({ envelope: envelope("desk.notAllowed") });
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
