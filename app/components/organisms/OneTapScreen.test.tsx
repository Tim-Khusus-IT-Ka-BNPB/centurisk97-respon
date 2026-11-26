import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { envelope } from "../../../src/api/envelope";
import type { PositionResult } from "../../lib/device";
import { TextContext } from "../../lib/text";
import { renderPage, text } from "../../testing/render";

const device = vi.hoisted(() => ({ read: null as unknown }));
vi.mock("../../lib/device", () => ({ readPosition: () => device.read }));

import { OneTapScreen } from "./OneTapScreen";

const START = { name: "Uji Satu", maskedNumber: "0800****0001", contact: { level: "national" as const } };
const SENT = {
  ticketNumber: "LA-241126-01",
  trackingToken: "0123456789abcdef0123456789abcdef",
  contact: { level: "regency" as const, name: "Aceh Utara", phone: "0800-1108-0001" },
};
const READ: PositionResult = { kind: "read", position: { lat: 5.1, lon: 97, accuracy: 12, readAt: 1 } };
const calls: { url: string; body: unknown }[] = [];
const answer = (response: () => Response) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return response();
    }),
  );
const draw = (entry = "/lapor/darurat", start: Parameters<typeof OneTapScreen>[0]["start"] = START) =>
  renderPage(<OneTapScreen start={start} />, { path: "/lapor/darurat", entry });
const phones = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"))
    .filter((href) => href?.startsWith("tel:"));

beforeEach(() => {
  calls.length = 0;
  device.read = Promise.resolve(READ);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("one tap", () => {
  test("shows who to call before the phone is read, then sends its point once", async () => {
    let found: (result: PositionResult) => void = () => {};
    device.read = new Promise<PositionResult>((resolve) => (found = resolve));
    answer(() => Response.json(SENT, { status: 201 }));
    draw("/lapor/darurat?ketuk=1", { ...START, contact: SENT.contact });
    expect(await screen.findByText(/Membaca lokasi ponsel/)).toBeTruthy();
    expect(phones()).toEqual(["tel:112", "tel:117", "tel:080011080001"]);
    expect(calls).toEqual([]);
    await act(async () => found(READ));
    expect(await screen.findByText("Terkirim ke meja BNPB dengan nomor LA-241126-01.")).toBeTruthy();
    expect(calls).toEqual([
      {
        url: "/api/lapor/emergencies",
        body: { lat: 5.1, lon: 97, accuracyM: 12, clientId: expect.any(String), takenAtMs: expect.any(Number) },
      },
    ]);
    expect(screen.getByRole("link", { name: "Lihat dan lengkapi laporan" }).getAttribute("href")).toBe(
      `/lapor/reports/${SENT.ticketNumber}`,
    );
  });

  test("opened with no tap sends nothing until its button is pressed; the place then names its BPBD", async () => {
    answer(() => Response.json(SENT, { status: 201 }));
    draw();
    expect(await screen.findByText(/Terkirim atas nama Uji Satu, 0800\*\*\*\*0001/)).toBeTruthy();
    expect(screen.getByText(/Nomor BPBD setempat muncul/)).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Kirim titik lokasi sekarang" }));
    expect(await screen.findByRole("link", { name: /BPBD Aceh Utara/ })).toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  test("says it is sending while the point is on its way", async () => {
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (finish = resolve)));
    draw("/lapor/darurat?ketuk=1");
    expect(await screen.findByText("Mengirim titik lokasi...")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tunggu sebentar..." })).toBeTruthy();
    await act(async () => finish(Response.json(SENT, { status: 201 })));
    expect(await screen.findByText(/Terkirim ke meja BNPB/)).toBeTruthy();
  });

  test.each([
    ["denied", /Izin lokasi ditolak/],
    ["unavailable", /Lokasi belum terbaca/],
    ["unsupported", /Peramban ini tidak bisa membaca lokasi/],
  ] as const)("a position %s is told with the other way to report, and nothing is sent", async (kind, words) => {
    device.read = Promise.resolve({ kind });
    answer(() => Response.json(SENT));
    draw("/lapor/darurat?ketuk=1");
    expect(await screen.findByText(words)).toBeTruthy();
    expect(calls).toEqual([]);
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lapor darurat dengan keterangan" }).getAttribute("href")).toBe(
      "/lapor/report?darurat=1",
    );
  });

  test("a tap too soon names when it opens again; a place refused names its fix", async () => {
    answer(() =>
      Response.json(
        {
          ...envelope("limit.oneTap.device", { params: { limit: 1 } }),
          retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" },
        },
        { status: 429 },
      ),
    );
    const view = draw("/lapor/darurat?ketuk=1");
    expect(await screen.findByText(/sudah terkirim dari ponsel ini. Bisa dikirim lagi mulai/)).toBeTruthy();
    view.unmount();
    answer(() =>
      Response.json(
        {
          ...envelope("request.invalidFields"),
          fields: [{ fieldId: "place", copyKey: "fieldError.emergency.outside", params: {} }],
        },
        { status: 422 },
      ),
    );
    draw("/lapor/darurat?ketuk=1");
    expect(await screen.findByText(/Titik ini di luar Indonesia/)).toBeTruthy();
  });

  test("with no script it shows who to call and the other way to report", () => {
    const Stub = createRoutesStub([{ path: "/", Component: Served }]);
    const page = document.createElement("div");
    page.innerHTML = renderToString(<Stub />);
    expect(page.querySelector("button")).toBeNull();
    expect(page.textContent).toContain("Mengirim titik lokasi perlu JavaScript.");
    expect(page.querySelectorAll('a[href^="tel:"]')).toHaveLength(2);
  });
});

function Served() {
  return (
    <TextContext.Provider value={text}>
      <OneTapScreen start={START} />
    </TextContext.Provider>
  );
}

describe("with no signal", () => {
  test("the point is kept on the phone with what it tells, and goes when signal returns", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    answer(() => Response.json(SENT, { status: 201 }));
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Kirim titik lokasi sekarang" }));
    expect(await screen.findByText(/^Tidak ada sinyal\. Laporan tersimpan di ponsel ini/)).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.change(screen.getByLabelText("Kejadian apa? Boleh dilewati"), { target: { value: "flood" } });
    fireEvent.click(screen.getByLabelText("Ya, ada"));
    fireEvent.change(screen.getByLabelText("Kejadian apa? Boleh dilewati"), { target: { value: "" } });
    const kept = JSON.parse(localStorage.getItem("lapor-offline-reports") as string);
    expect(kept).toEqual([expect.objectContaining({ lat: 5.1, lon: 97, accuracyM: 12, victims: "yes" })]);
    expect(kept[0].hazardType).toBeUndefined();
    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    await act(async () => {
      dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText("Terkirim ke meja BNPB dengan nomor LA-241126-01.")).toBeTruthy();
    expect(calls[0]?.body).toMatchObject({ clientId: kept[0].clientId, victims: "yes" });
    expect(localStorage.getItem("lapor-offline-reports")).toBeNull();
  });

  test("a send the network does not carry is kept; Kirim sekarang tries again", async () => {
    answer(() => {
      throw new TypeError("offline");
    });
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Kirim titik lokasi sekarang" }));
    expect(await screen.findByText(/^Tidak ada sinyal/)).toBeTruthy();
    answer(() => Response.json(SENT, { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "Kirim sekarang" }));
    expect(await screen.findByText("Terkirim ke meja BNPB dengan nomor LA-241126-01.")).toBeTruthy();
  });

  test("a report kept before goes as soon as the page opens with signal", async () => {
    localStorage.setItem(
      "lapor-offline-reports",
      JSON.stringify([
        { clientId: "00000000-0000-4000-8000-000000000001", lat: 5, lon: 97, accuracyM: 9, takenAtMs: 1 },
      ]),
    );
    answer(() => Response.json(SENT, { status: 201 }));
    draw();
    await waitFor(() => expect(screen.getByText("Terkirim ke meja BNPB dengan nomor LA-241126-01.")).toBeTruthy());
  });
});
