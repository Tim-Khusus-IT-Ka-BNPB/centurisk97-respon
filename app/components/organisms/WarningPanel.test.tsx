import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PushBrowser } from "../../lib/push";
import { renderPage } from "../../testing/render";
import { WarningPanel } from "./WarningPanel";

const PHONE = {
  endpoint: "https://fcm.googleapis.com/fcm/send/uji",
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
};
const KEY = `B${"A".repeat(86)}`;
const ON = { districts: [{ code: "11.08.01", name: "Baktiya" }], hazards: 3, threshold: 2 };
const SEARCH = {
  items: [
    {
      level: "village",
      code: "11.08.02.2001",
      name: "Uji",
      districtName: "Lhoksukon",
      regencyName: "Aceh Utara",
      provinceName: "Aceh",
    },
    {
      level: "district",
      code: "11.08.01",
      name: "Baktiya",
      districtName: null,
      regencyName: "Aceh Utara",
      provinceName: "Aceh",
    },
  ],
  total: 2,
  cut: false,
  dataDate: "2026-11-01",
};

type Routes = Record<string, { status: number; body?: unknown }>;
const calls: { url: string; init: RequestInit | undefined }[] = [];
function answer(routes: Routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const found = routes[`${init?.method ?? "GET"} ${url.split("?")[0]}`] ?? { status: 503, body: {} };
      return new Response(found.body === undefined ? null : JSON.stringify(found.body), { status: found.status });
    }),
  );
}

const stop = vi.fn(async () => true);
const fakePush = (over: Partial<PushBrowser> & { subscribed?: boolean } = {}): PushBrowser => {
  let subscribed = over.subscribed ?? false;
  return {
    supported: async () => true,
    denied: () => false,
    current: async () => (subscribed ? { phone: PHONE, stop } : null),
    subscribe: async () => {
      subscribed = true;
      return { phone: PHONE, stop };
    },
    ...over,
  };
};

const draw = (push: PushBrowser) => renderPage(<WarningPanel push={push} />, { path: "/lapor/info" });
const sentBody = (method: string, path: string) =>
  JSON.parse(calls.find((call) => call.init?.method === method && call.url === path)?.init?.body as string);

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("warnings to this phone", () => {
  test("a phone picks a district by search, a hazard less and a level, and is warned", async () => {
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "GET /api/lapor/places/search": { status: 200, body: SEARCH },
      "PUT /api/lapor/warnings": { status: 200, body: ON },
    });
    draw(fakePush());
    fireEvent.click(await screen.findByRole("button", { name: "Nyalakan peringatan" }));
    expect(await screen.findByText("Pilih paling sedikit satu kecamatan.")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Cari kecamatan atau desa" }), {
      target: { value: "aceh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cari" }));
    const found = await screen.findByText("Kec. Lhoksukon, Aceh Utara");
    expect(screen.getByText("Kec. Baktiya, Aceh Utara")).toBeTruthy();
    fireEvent.click(within(found).getByRole("button", { name: "Tambah" }));
    fireEvent.click(within(found).getByRole("button", { name: "Tambah" }));
    expect(screen.getByText("Kecamatan dipilih, 1 dari 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Asap" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Angin kencang" }));
    fireEvent.click(screen.getByRole("radio", { name: "Siaga" }));
    fireEvent.click(screen.getByRole("button", { name: "Nyalakan peringatan" }));
    expect(await screen.findByText("Peringatan menyala untuk Baktiya, mulai tingkat Siaga.")).toBeTruthy();
    expect(sentBody("PUT", "/api/lapor/warnings")).toEqual({
      ...PHONE,
      districts: ["11.08.02"],
      hazards: 3,
      threshold: 2,
    });
  });

  test("with no hazard ticked it says so and sends nothing", async () => {
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "POST /api/lapor/warnings/status": { status: 200, body: ON },
    });
    draw(fakePush({ subscribed: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah" }));
    for (const name of ["Banjir", "Tanah longsor"]) fireEvent.click(screen.getByRole("checkbox", { name }));
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    expect(await screen.findByText("Pilih paling sedikit satu jenis ancaman.")).toBeTruthy();
    expect(calls.some((call) => call.init?.method === "PUT")).toBe(false);
  });

  test("a phone already warned sees what of, changes it, cancels, and stops", async () => {
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "POST /api/lapor/warnings/status": { status: 200, body: ON },
      "POST /api/lapor/warnings/stop": { status: 204 },
    });
    draw(fakePush({ subscribed: true }));
    expect(await screen.findByText("Peringatan menyala untuk Baktiya, mulai tingkat Siaga.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ubah" }));
    expect(screen.getByRole("button", { name: "Hapus Kec. Baktiya" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Siaga" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Asap" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Hapus Kec. Baktiya" }));
    expect(screen.getByText("Kecamatan dipilih, 0 dari 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Matikan peringatan" }));
    expect(await screen.findByText("Peringatan dimatikan untuk ponsel ini.")).toBeTruthy();
    expect(stop).toHaveBeenCalled();
    expect(sentBody("POST", "/api/lapor/warnings/stop")).toEqual({ endpoint: PHONE.endpoint });
    expect(screen.getByRole("button", { name: "Nyalakan peringatan" })).toBeTruthy();
  });

  test("a phone subscribed but warned of nothing picks again; one whose subscription went stops at once", async () => {
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "POST /api/lapor/warnings/status": { status: 200, body: { districts: [], hazards: null, threshold: null } },
    });
    const view = draw(fakePush({ subscribed: true }));
    expect(await screen.findByRole("button", { name: "Nyalakan peringatan" })).toBeTruthy();
    view.unmount();
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "POST /api/lapor/warnings/status": { status: 200, body: ON },
    });
    let gone = false;
    draw(fakePush({ subscribed: true, current: async () => (gone ? null : { phone: PHONE, stop }) }));
    await screen.findByText("Peringatan menyala untuk Baktiya, mulai tingkat Siaga.");
    gone = true;
    calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Matikan peringatan" }));
    expect(await screen.findByText("Peringatan dimatikan untuk ponsel ini.")).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/warnings/stop"))).toBe(false);
  });

  test("warnings shut between opening and saving: not saved, and said so", async () => {
    let keyed = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        keyed += url.endsWith("/warnings/key") ? 1 : 0;
        const body = url.endsWith("/warnings/key") ? { publicKey: keyed === 1 ? KEY : null } : ON;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    draw(fakePush({ subscribed: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah" }));
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    expect(await screen.findByText(/^Belum tersimpan/)).toBeTruthy();
  });

  test("three districts at most", async () => {
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "POST /api/lapor/warnings/status": {
        status: 200,
        body: { ...ON, districts: ["01", "02", "03"].map((n) => ({ code: `11.08.${n}`, name: `D${n}` })) },
      },
    });
    draw(fakePush({ subscribed: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Ubah" }));
    expect(screen.getByText("Sudah 3 kecamatan. Hapus satu untuk menambah yang lain.")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  test("a stop or a save that does not reach the service says so", async () => {
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "POST /api/lapor/warnings/status": { status: 200, body: ON },
    });
    draw(fakePush({ subscribed: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Matikan peringatan" }));
    expect(await screen.findByText(/^Belum tersimpan/)).toBeTruthy();
    expect(screen.getByText("Peringatan menyala untuk Baktiya, mulai tingkat Siaga.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ubah" }));
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PUT")).toBe(true));
    expect(screen.getByText(/^Belum tersimpan/)).toBeTruthy();
  });

  test("leave refused when asked: it says how to allow it", async () => {
    answer({ "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } } });
    let denied = false;
    draw(
      fakePush({
        denied: () => denied,
        subscribe: async () => {
          denied = true;
          return null;
        },
      }),
    );
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "ab" } });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "a" });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(calls.some((call) => call.url.startsWith("/api/lapor/places"))).toBe(false);
    answer({
      "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } },
      "GET /api/lapor/places/search": { status: 200, body: SEARCH },
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "baktiya" } });
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    fireEvent.click(
      within(await screen.findByText("Kec. Baktiya, Aceh Utara")).getByRole("button", { name: "Tambah" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Nyalakan peringatan" }));
    expect(await screen.findByText(/^Izin notifikasi untuk situs ini ditolak/)).toBeTruthy();
  });

  test.each([
    ["no push in this browser", fakePush({ supported: async () => false }), {}, /^Peramban ini belum bisa/],
    [
      "warnings shut",
      fakePush(),
      { "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: null } } },
      /^Peringatan ke ponsel belum dibuka/,
    ],
    [
      "notifications refused before",
      fakePush({ denied: () => true }),
      { "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } } },
      /^Izin notifikasi/,
    ],
  ] as const)("%s: it says so", async (_why, push, routes, words) => {
    answer(routes as Routes);
    draw(push);
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nyalakan peringatan" })).toBeNull();
  });

  test("a search that finds nothing, or cannot be read, says none match", async () => {
    answer({ "GET /api/lapor/warnings/key": { status: 200, body: { publicKey: KEY } } });
    draw(fakePush());
    fireEvent.change(await screen.findByRole("searchbox"), { target: { value: "zzzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Cari" }));
    expect(await screen.findByText("Tidak ada kecamatan yang cocok. Periksa ejaannya.")).toBeTruthy();
  });
});
