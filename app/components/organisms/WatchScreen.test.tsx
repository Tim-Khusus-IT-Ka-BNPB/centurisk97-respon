import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { envelope as apiEnvelope } from "../../../src/api/envelope";
import { WATCH } from "../../testing/feed";
import { renderPage } from "../../testing/render";
import { WatchScreen } from "./WatchScreen";

const draw = (load: Parameters<typeof WatchScreen>[0]["load"]) =>
  renderPage(<WatchScreen load={load} />, { path: "/feed", entry: "/feed?mode=peringatan" });

test("the regencies on watch with their level and threats, and volcanoes by level with how far to keep away", async () => {
  draw({ kind: "watch", watch: WATCH });
  const forecast = within((await screen.findByRole("region", { name: "Status prakiraan 3 hari" })) as HTMLElement);
  const regency = forecast.getByRole("link", { name: /Kab\. Aceh Utara/ });
  expect(regency.getAttribute("href")).toBe("/info?regency=11.08");
  expect(regency.textContent).toContain("Siaga");
  expect(regency.textContent).toContain("Banjir, Longsor");
  const volcanoes = within(screen.getByRole("region", { name: "Status gunung api" }));
  expect(
    volcanoes
      .getAllByRole("listitem")
      .slice(0, 4)
      .map((one) => one.textContent),
  ).toEqual(["42Normal", "24Waspada", "2Siaga", "1Awas"]);
  expect(volcanoes.getByText("Gunung Uji")).toBeTruthy();
  expect(volcanoes.getByText(/Jauhi radius 7 km dari kawah/)).toBeTruthy();
  expect(volcanoes.getByText(/Ikuti imbauan petugas setempat/)).toBeTruthy();
  expect(volcanoes.getAllByRole("link").map((one) => one.getAttribute("href"))).toEqual([
    "https://magma.esdm.go.id/v1/x",
  ]);
  // The view's own link is marked as the one open.
  expect(screen.getByRole("link", { name: "Peringatan" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Kejadian" }).getAttribute("href")).toBe("/feed");
});

test("nothing on watch says so; a file not read says it cannot be known", async () => {
  draw({
    kind: "watch",
    watch: {
      forecast: { madeAt: WATCH.forecast?.madeAt as string, regencies: [] },
      volcanoes: { ...(WATCH.volcanoes as NonNullable<typeof WATCH.volcanoes>), raised: [] },
    },
  });
  expect(await screen.findByText(/Tidak ada kabupaten atau kota/)).toBeTruthy();
  expect(screen.getByText("Tidak ada gunung api berstatus Siaga atau Awas.")).toBeTruthy();
});

test("files not read, a limit, or the service down: each said", async () => {
  const view = draw({ kind: "watch", watch: { forecast: null, volcanoes: null } });
  expect(await screen.findByText(/Prakiraan belum bisa dibaca/)).toBeTruthy();
  expect(screen.getByText("Status gunung api belum bisa dibaca.")).toBeTruthy();
  view.unmount();
  const limited = draw({
    kind: "unavailable",
    envelope: apiEnvelope("limit.address.feed", { params: { limit: 600 } }),
  });
  expect(await screen.findByText(/600/)).toBeTruthy();
  limited.unmount();
  draw({ kind: "unavailable", envelope: null });
  expect(await screen.findByText("Peringatan belum bisa dimuat. Coba lagi sebentar lagi.")).toBeTruthy();
});
