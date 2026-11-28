import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { never, renderPage } from "../../../testing/render";
import { DeskOfficers } from "./DeskOfficers";

const ANDI = {
  profileId: "profile-a",
  name: "Uji Andi",
  position: "Pusdalops",
  agency: "BPBD Kabupaten Uji Satu",
  level: "regency" as const,
  masked: "0800****8001",
  signedInAt: { utc: "2026-11-27T02:30:00.000Z", zone: "WIB" as const },
};
const SARI = {
  ...ANDI,
  profileId: "profile-p",
  name: "Uji Sari",
  agency: "BPBD Provinsi Uji",
  level: "province" as const,
  signedInAt: null,
};

const draw = (props: Parameters<typeof DeskOfficers>[0]) =>
  renderPage(<DeskOfficers {...props} />, { path: "/desk/LA-261126-01", action: never });

describe("the BPBD officers on a report", () => {
  test("each with a masked number to open; an opened one is called", async () => {
    draw({
      officers: { items: [ANDI, SARI], official: null },
      opened: { profileId: "profile-p", number: "+628001108009" },
    });
    const [andi, sari] = (await screen.findAllByRole("listitem")) as [HTMLElement, HTMLElement];
    expect(within(andi).getByText("Pusdalops, BPBD Kabupaten Uji Satu")).toBeTruthy();
    expect(within(andi).getByText("0800****8001")).toBeTruthy();
    expect(within(andi).getByText("UA")).toBeTruthy();
    expect(within(andi).getByText("Terakhir masuk 27 November 2026, pukul 09.30 WIB")).toBeTruthy();
    expect(within(sari).queryByText(/^Terakhir masuk/)).toBeNull();
    expect(within(sari).getByText("Pusdalops, BPBD Provinsi Uji, tingkat provinsi")).toBeTruthy();
    expect(within(sari).getByText("+62 800-1108-009")).toBeTruthy();
    expect(within(sari).getByRole("link", { name: "Telepon" }).getAttribute("href")).toBe("tel:+628001108009");
    expect(screen.queryByText(/Belum ada PIC/)).toBeNull();
  });

  test("opening a number says so while it is asked for", async () => {
    draw({ officers: { items: [ANDI], official: null }, opened: null });
    const open = await screen.findByRole("button", { name: "Tampilkan nomor Uji Andi" });
    const form = open.closest("form") as HTMLFormElement;
    expect((form.elements.namedItem("action") as HTMLInputElement).value).toBe("officerNumber");
    expect((form.elements.namedItem("profileId") as HTMLInputElement).value).toBe("profile-a");
    fireEvent.click(open);
    expect(await screen.findByText("Membuka nomor...")).toBeTruthy();
  });

  test("with no officer of the regency, the BPBD's own number, or BNPB's 117 when the file has none", async () => {
    const view = draw({
      officers: { items: [], official: { level: "regency", name: "BPBD Aceh Utara", phone: "(0645) 123-456" } },
      opened: null,
    });
    expect(await screen.findByText("Belum ada PIC aktif di BPBD kabupaten atau kota ini.")).toBeTruthy();
    expect(screen.getByText("Nomor resmi dari daftar kontak BPBD")).toBeTruthy();
    expect(screen.getByRole("link", { name: "(0645) 123-456" }).getAttribute("href")).toBe("tel:0645123456");
    view.unmount();
    draw({ officers: { items: [], official: { level: "national" } }, opened: null });
    expect(await screen.findByText("Call center BNPB")).toBeTruthy();
    expect(screen.getByText("Nomor BPBD ini belum ada di daftar kontak")).toBeTruthy();
    expect(screen.getByRole("link", { name: "117" }).getAttribute("href")).toBe("tel:117");
  });
});
