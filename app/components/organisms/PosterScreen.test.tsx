import { fireEvent, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, test, vi } from "vitest";
import { qrModules } from "../../../src/domain/qr";
import { TextContext } from "../../lib/text";
import { renderPage, text } from "../../testing/render";
import { type PosterLoad, PosterScreen, posterLink } from "./PosterScreen";

const village = (code: string, name: string) => ({
  level: "village" as const,
  code,
  name,
  districtName: "Baktiya",
  regencyName: "Aceh Utara",
  provinceName: "Aceh",
});
const draw = (load: PosterLoad) =>
  renderPage(<PosterScreen load={load} origin="https://respon.example.test" />, { path: "/poster" });

describe("the village posters", () => {
  test("a district's villages, one sheet each with its code to the report, printed from one button", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    draw({
      kind: "sheets",
      query: "",
      area: { name: "Baktiya", regencyName: "Aceh Utara" },
      district: "11.08.01",
      villages: [village("11.08.01.2001", "Uji Satu"), village("11.08.01.2002", "Uji Dua")],
      one: false,
      cut: true,
    });
    expect(await screen.findByText("2 poster untuk Kec. Baktiya, Aceh Utara")).toBeTruthy();
    expect(screen.getByText(/^Kecamatan ini punya lebih banyak desa/)).toBeTruthy();
    const sheets = screen.getAllByRole("article");
    expect(sheets).toHaveLength(2);
    const first = within(sheets[0] as HTMLElement);
    expect(first.getByRole("heading", { name: "Lapor kejadian bencana di sini" })).toBeTruthy();
    expect(first.getByText("Kec. Baktiya, Aceh Utara, Aceh")).toBeTruthy();
    expect(first.getByRole("img", { name: "Kode QR halaman lapor untuk Desa/Kel. Uji Satu" })).toBeTruthy();
    expect(first.getByText("Nyawa terancam? Telepon 112 sekarang.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cetak poster" }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "Semua desa di kecamatan ini" })).toBeNull();
  });

  test("its code holds the report's address with the village's ten digits", () => {
    const link = posterLink("https://respon.example.test", "11.08.01.2001");
    expect(link).toBe("https://respon.example.test/report?village=1108012001");
    expect(qrModules(link).length).toBeGreaterThan(20);
  });

  test("one village picked, with the way back to all of its district", async () => {
    draw({
      kind: "sheets",
      query: "",
      area: { name: "Baktiya", regencyName: "Aceh Utara" },
      district: "11.08.01",
      villages: [village("11.08.01.2001", "Uji Satu")],
      one: true,
      cut: false,
    });
    expect(await screen.findByText("1 poster untuk Desa/Kel. Uji Satu")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Semua desa di kecamatan ini" }).getAttribute("href")).toBe(
      "/poster?district=11.08.01",
    );
  });

  test("a search lists districts and villages, each leading to its posters; regencies are left out", async () => {
    draw({
      kind: "results",
      query: "baktiya",
      items: [
        { ...village("11.08", "Aceh Utara"), level: "regency", districtName: null },
        { ...village("11.08.01", "Baktiya"), level: "district", districtName: null },
        village("11.08.01.2001", "Uji Satu"),
      ],
    });
    const links = within(await screen.findByRole("region", { name: "Hasil pencarian" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Kec. Baktiya, Aceh Utara", "/poster?district=11.08.01"],
      ["Desa/Kel. Uji Satu, Kec. Baktiya, Aceh Utara", "/poster?district=11.08.01&village=11.08.01.2001"],
    ]);
    expect((screen.getByLabelText("Kecamatan atau desa/kelurahan") as HTMLInputElement).value).toBe("baktiya");
  });

  test("no match, too short, or the list unreadable each say so", async () => {
    const view = draw({ kind: "results", query: "zzz", items: [] });
    expect(await screen.findByText('Tidak ada kecamatan atau desa yang cocok dengan "zzz".')).toBeTruthy();
    view.unmount();
    const short = draw({ kind: "short", query: "ab" });
    expect(await screen.findByText("Ketik paling sedikit 3 huruf.")).toBeTruthy();
    short.unmount();
    draw({ kind: "unavailable", query: "baktiya" });
    expect(await screen.findByText(/^Daftar desa belum bisa dibaca/)).toBeTruthy();
    expect(screen.queryAllByRole("article")).toEqual([]);
  });
});

const SHEETS: PosterLoad = {
  kind: "sheets",
  query: "",
  area: { name: "Baktiya", regencyName: "Aceh Utara" },
  district: "11.08.01",
  villages: [village("11.08.01.2001", "Uji Satu")],
  one: false,
  cut: false,
};
const SheetsPage = () => <PosterScreen load={SHEETS} origin="" />;

test("with no script the browser's own print is used: no button that does nothing", () => {
  const Stub = createRoutesStub([{ path: "/poster", Component: SheetsPage }]);
  const html = renderToStaticMarkup(
    <TextContext.Provider value={text}>
      <Stub initialEntries={["/poster"]} />
    </TextContext.Provider>,
  );
  expect(html).toContain("Uji Satu");
  expect(html).not.toContain("Cetak poster");
});
