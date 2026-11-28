import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TextContext } from "../../lib/text";
import { OUTLOOK } from "../../testing/outlook";
import { never, renderPage, text } from "../../testing/render";
import { analysisOf, type InfoLoad, InfoScreen } from "./InfoScreen";

const draw = (load: InfoLoad) => renderPage(<InfoScreen load={load} />, { path: "/info" });
const phones = () =>
  screen
    .getAllByRole("link")
    .flatMap((link) => link.getAttribute("href") ?? [])
    .filter((href) => href.startsWith("tel:"));

describe("the regional outlook", () => {
  test("three days, each level in words, the advice, and the regency's BPBD after 112 and 117", async () => {
    draw({ kind: "outlook", query: "", outlook: OUTLOOK });
    expect(await screen.findByRole("heading", { name: "Tiga hari ke depan di Kab. Aceh Utara" })).toBeTruthy();
    expect(screen.getByText(/^Provinsi Aceh\. Prakiraan dibuat 26 November 2026/)).toBeTruthy();
    const days = screen.getAllByRole("listitem").filter((item) => item.querySelector("h3"));
    expect(days.map((day) => day.querySelector("h3")?.textContent)).toEqual([
      "Kamis, 26 November",
      "Jumat, 27 November",
      "Sabtu, 28 November",
    ]);
    const first = within(days[0] as HTMLElement);
    expect(first.getByText("Hujan 62 mm")).toBeTruthy();
    expect(first.getByText("Siaga")).toBeTruthy();
    expect(
      within(first.getByRole("list", { name: "Peringatan" }))
        .getAllByRole("listitem")
        .map((one) => one.textContent),
    ).toEqual(["BanjirAwas", "LongsorWaspada"]);
    expect(within(days[1] as HTMLElement).getByText("Normal")).toBeTruthy();
    expect(within(days[1] as HTMLElement).getByText("Tidak ada peringatan di atas Normal.")).toBeTruthy();
    expect(within(days[2] as HTMLElement).getByText("Curah hujan belum diketahui")).toBeTruthy();
    expect(screen.getByText(": Siapkan tas siaga", { exact: false })).toBeTruthy();
    expect(phones()).toEqual(["tel:112", "tel:117", "tel:080011080001"]);
    expect(screen.getByRole("link", { name: "Ganti wilayah" }).getAttribute("href")).toBe("/info");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  test("the analysis says the highest level of the three days and its threats, with a few figures", async () => {
    draw({ kind: "outlook", query: "", outlook: OUTLOOK });
    expect(await screen.findByText("Status 3 hari ke depan: Awas")).toBeTruthy();
    expect(screen.getByText("Paling tinggi: Banjir")).toBeTruthy();
    const figures = [...document.querySelectorAll("dl > div")].map((one) => one.textContent);
    expect(figures).toEqual(["Ancaman2", "Hari Waspada ke atas1 dari 3 hari", "Hujan terbesarHujan 62 mm"]);
    expect(
      analysisOf({ ...OUTLOOK, days: [{ date: "2026-11-27", rainMm: null, rainLevel: null, threats: [] }] }),
    ).toEqual({
      top: 0,
      atTop: [],
      threats: 0,
      alertDays: 0,
      peakRain: null,
    });
  });

  test("a calm three days says so, with no rain figure shown as a dash", async () => {
    draw({
      kind: "outlook",
      query: "",
      outlook: { ...OUTLOOK, days: [{ date: "2026-11-27", rainMm: null, rainLevel: null, threats: [] }] },
    });
    expect(await screen.findByText("Status 3 hari ke depan: Normal")).toBeTruthy();
    expect(screen.getByText("Tidak ada ancaman yang diperkirakan.")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
  });

  test("with no BPBD of its own and no advice: 112 and 117 alone", async () => {
    draw({ kind: "outlook", query: "", outlook: { ...OUTLOOK, advice: [], contact: { level: "national" } } });
    expect(await screen.findByRole("heading", { name: "Nomor yang bisa ditelepon" })).toBeTruthy();
    expect(phones()).toEqual(["tel:112", "tel:117"]);
    expect(screen.queryByText("Yang perlu disiapkan")).toBeNull();
  });

  test("a search lists each regency once, linked to its outlook; the numbers show before any is picked", async () => {
    draw({
      kind: "results",
      query: "aceh",
      regencies: [
        { code: "11.08", name: "Aceh Utara", provinceName: "Aceh" },
        { code: "11.06", name: "Aceh Besar", provinceName: "Aceh" },
      ],
    });
    const found = await screen.findByRole("link", { name: "Aceh Utara, Aceh" });
    expect(found.getAttribute("href")).toBe("/info?regency=11.08");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("aceh");
    expect(phones()).toEqual(["tel:112", "tel:117"]);
  });

  test.each([
    [{ kind: "results", query: "zzz", regencies: [] }, 'Tidak ada wilayah yang cocok dengan "zzz".'],
    [{ kind: "short", query: "ab" }, "Ketik paling sedikit 3 huruf."],
    [{ kind: "unavailable", query: "" }, "Prakiraan belum bisa dibuka sekarang."],
    [{ kind: "none", query: "" }, "Belum ada prakiraan untuk kabupaten atau kota ini."],
  ] as const)("%o says so", async (load, words) => {
    draw(load as InfoLoad);
    expect(await screen.findByText(words, { exact: false })).toBeTruthy();
  });

  test("before a search, only the box and the numbers", async () => {
    draw({ kind: "start", query: "" });
    expect(await screen.findByRole("searchbox")).toBeTruthy();
    expect(screen.queryByText("Pilih kabupaten atau kota")).toBeNull();
    expect(phones()).toEqual(["tel:112", "tel:117"]);
  });
});

// The server's render of the page: what a phone with no script receives.
const Served = () => (
  <TextContext.Provider value={text}>
    <InfoScreen load={{ kind: "start", query: "" }} />
  </TextContext.Provider>
);

describe("the phone's place opens its regency", () => {
  afterEach(() => vi.unstubAllGlobals());
  const geolocation = (outcome: { readonly lat: number } | { readonly code: number }) =>
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: {
        getCurrentPosition(ok: PositionCallback, fail: PositionErrorCallback) {
          if ("code" in outcome) fail({ code: outcome.code } as GeolocationPositionError);
          else
            ok({
              coords: { latitude: outcome.lat, longitude: 97.0482, accuracy: 12 },
              timestamp: 0,
            } as GeolocationPosition);
        },
      },
    });

  test("the reading goes in a post, never in the address, and the button says it is reading", async () => {
    geolocation({ lat: 5.14705 });
    const posts: Record<string, FormDataEntryValue>[] = [];
    renderPage(<InfoScreen load={{ kind: "start", query: "" }} />, {
      path: "/info",
      action: async ({ request }: { request: Request }) => {
        posts.push(Object.fromEntries(await request.formData()));
        return never();
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Pakai lokasi saat ini" }));
    await waitFor(() => expect(posts).toEqual([{ action: "locate", lat: "5.14705", lon: "97.0482", accuracy: "12" }]));
    expect(await screen.findByRole("button", { name: "Membaca lokasi..." })).toBeTruthy();
  });

  test("a refused reading says what to do; a place outside the data, or data unreadable, says so", async () => {
    geolocation({ code: 1 });
    const view = renderPage(<InfoScreen load={{ kind: "start", query: "" }} />, { path: "/info" });
    fireEvent.click(await screen.findByRole("button", { name: "Pakai lokasi saat ini" }));
    expect(await screen.findByText(/Izin lokasi ditolak/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Coba lagi" })).toBeTruthy();
    view.unmount();
    const none = renderPage(<InfoScreen load={{ kind: "start", query: "" }} located="none" />, { path: "/info" });
    expect(await screen.findByText(/belum cocok dengan desa mana pun/)).toBeTruthy();
    none.unmount();
    renderPage(<InfoScreen load={{ kind: "start", query: "" }} located="unavailable" />, { path: "/info" });
    expect(await screen.findByRole("button", { name: "Pakai lokasi saat ini" })).toBeTruthy();
    expect(
      screen
        .getAllByRole("alert")
        .map((one) => one.textContent)
        .join(" "),
    ).toMatch(/\S/);
  });

  test("with no script the page offers the search alone", () => {
    const Stub = createRoutesStub([{ path: "/info", Component: Served }]);
    const page = document.createElement("div");
    page.innerHTML = renderToString(<Stub initialEntries={["/info"]} />);
    expect(page.textContent).not.toContain("Pakai lokasi saat ini");
    expect(page.querySelector('input[name="q"]')).not.toBeNull();
  });

  test("a regency's own page offers no reading", async () => {
    draw({ kind: "outlook", query: "", outlook: OUTLOOK });
    expect(await screen.findByRole("link", { name: "Ganti wilayah" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pakai lokasi saat ini" })).toBeNull();
  });
});
