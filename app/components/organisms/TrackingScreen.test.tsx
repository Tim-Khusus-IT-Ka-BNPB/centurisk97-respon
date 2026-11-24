import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Card } from "../../../src/contract/card";
import { SAMPLE_DRAFTS } from "../../../src/testing/samples";
import { renderPage } from "../../testing/render";
import { TrackingScreen } from "./TrackingScreen";

const TOKEN = "0123456789abcdef0123456789abcdef";
const tracking = (SAMPLE_DRAFTS.sent.card as Extract<Card, { kind: "sent" }>).tracking;
const calls: { url: string; init: RequestInit }[] = [];

function answer(status: number, body: unknown = null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body === null ? null : JSON.stringify(body), { status });
    }),
  );
}

const draw = () => renderPage(<TrackingScreen />, { path: "/lapor/lacak" });

beforeEach(() => {
  calls.length = 0;
  window.location.hash = `#t=${TOKEN}`;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("tracking page", () => {
  test("reads the report by a POST that carries the token in its body, never in the address", async () => {
    answer(200, tracking);
    draw();
    expect(await screen.findByRole("heading", { level: 1, name: "LA-231126-01" })).toBeTruthy();
    expect(calls[0]?.url).toBe("/api/lapor/tracking");
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect(calls[0]?.init).toMatchObject({ method: "POST", body: JSON.stringify({ token: TOKEN }) });
    const status = screen.getByRole("region", { name: "Status laporan" });
    const stages = within(status)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(stages[0]).toBe("Laporan diterima23 November 2026, pukul 09.00 WIB");
    expect(stages.slice(1)).toEqual([
      "Sudah dilihat petugasMenunggu",
      "Sedang ditelaahMenunggu",
      "DitindaklanjutiMenunggu",
      "Selesai ditanganiMenunggu",
    ]);
    expect(within(status).getByText("Petugas akan menghubungi pelapor bila perlu keterangan tambahan.")).toBeTruthy();
    const event = screen.getByRole("region", { name: "Kejadian" });
    expect(within(event).getByText("Banjir")).toBeTruthy();
    expect(within(event).getByText("Desa/Kel. Sukamaju, Kec. Contoh, Aceh Utara")).toBeTruthy();
    expect(within(event).getByText("23 November 2026, jam tidak diketahui")).toBeTruthy();
    expect(within(event).getByText("2 foto")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Telepon 0800-1111-2222" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /117/ }).getAttribute("href")).toBe("tel:117");
    expect(document.body.textContent).not.toMatch(/Uji|0800\d|RT|RW/);
  });

  test("a time with its hour, an old event, no subtype and no event time each read as given", async () => {
    answer(200, {
      ...tracking,
      hazardSubtype: null,
      eventTime: { kind: "dateTime", localDate: "2026-11-23", localTime: "14:30", zone: "WIB" },
    });
    const { unmount } = draw();
    expect(await screen.findByText("23 November 2026, pukul 14.30 WIB")).toBeTruthy();
    expect(screen.queryByText("Karakteristik")).toBeNull();
    unmount();
    answer(200, { ...tracking, eventTime: { kind: "olderThan30Days" } });
    const old = draw();
    expect(await screen.findByText("Sudah lebih dari 30 hari")).toBeTruthy();
    old.unmount();
    answer(200, { ...tracking, eventTime: null });
    draw();
    await screen.findByRole("heading", { level: 1, name: "LA-231126-01" });
    expect(screen.queryByText("Waktu kejadian")).toBeNull();
  });

  test("an unknown link says so; a page with no fragment asks with an empty token", async () => {
    answer(404, { error: { code: "tracking.notFound" } });
    window.location.hash = "";
    draw();
    expect(await screen.findByRole("heading", { level: 1, name: "Laporan tidak ditemukan." })).toBeTruthy();
    expect(screen.getByText("Periksa lagi tautan yang Anda terima.")).toBeTruthy();
    expect(calls[0]?.init.body).toBe(JSON.stringify({ token: "" }));
  });

  test("past the hourly limit it says how many minutes until it opens again", async () => {
    const retry = new Date(Date.now() + 25 * 60_000 - 1000).toISOString();
    answer(429, { error: { params: { limit: 300 } }, retryAt: { utc: retry, zone: "WIB" } });
    const { unmount } = draw();
    expect(
      await screen.findByText(/sudah dibuka 300 kali dalam satu jam dari jaringan ini. Buka lagi dalam 25 menit/),
    ).toBeTruthy();
    unmount();
    answer(429, { error: { params: { limit: 300 } }, retryAt: null });
    draw();
    expect(await screen.findByText(/Buka lagi dalam 1 menit/)).toBeTruthy();
  });

  test("a failing service, or no connection, says it will try again", async () => {
    answer(503, {});
    const { unmount } = draw();
    expect(await screen.findByText(/layanan sedang terganggu/)).toBeTruthy();
    unmount();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    draw();
    expect(await screen.findByText(/layanan sedang terganggu/)).toBeTruthy();
  });

  test("a page closed before the answer arrives draws nothing more", async () => {
    let finish: (response: Response) => void = () => {};
    const pending = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", pending);
    const { unmount } = draw();
    await waitFor(() => expect(pending).toHaveBeenCalled());
    unmount();
    let read = false;
    finish({
      ok: true,
      status: 200,
      json: async () => {
        read = true;
        return tracking;
      },
    } as unknown as Response);
    await waitFor(() => expect(read).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toBe("");
  });

  test("it reads again every 30 seconds while in view, not while hidden, and stops when closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(200, tracking);
    const { unmount } = draw();
    await screen.findByRole("heading", { level: 1, name: "LA-231126-01" });
    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(() => expect(calls).toHaveLength(2));
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(2);
    hidden.mockRestore();
    unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
  });
});
