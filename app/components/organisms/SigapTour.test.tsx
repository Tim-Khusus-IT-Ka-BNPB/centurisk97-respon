import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PRIVACY } from "../../../src/domain/privacy";
import { TextContext } from "../../lib/text";
import { renderPage, text } from "../../testing/render";
import { HomeHero } from "./HomeHero";
import { HomeScreen } from "./HomeScreen";

const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  // jsdom draws nothing and has no dialog: what is hidden has no box, and closing says so.
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.closest("[hidden]") ? [] : [{}]) as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100,
    left: 20,
    width: 200,
    height: 80,
  } as DOMRect);
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute("aria-labelledby") ?? this.id);
  };
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => vi.restoreAllMocks());

const home = () =>
  renderPage(
    <>
      <header>
        <a href="/language?back=%2F" hidden>
          Bahasa
        </a>
      </header>
      <HomeHero sent={false} />
      <HomeScreen me={{ knownReporters: [], reports: [], privacyVersion: PRIVACY.version, session: null }} />
    </>,
    { path: "/" },
  );

test("the home's tour lights each part it can show, back and on, and ends or is skipped", async () => {
  home();
  fireEvent.click(await screen.findByRole("button", { name: "Lihat tur singkat" }));
  const tour = () => within(document.querySelector("dialog") as HTMLElement);
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce();
  expect(tour().getByRole("heading").textContent).toBe("Selamat datang di Pantau Bencana");
  // The hidden language is not shown, nor Laporan saya with nothing sent: the doors all are.
  expect(tour().getByText("1 dari 7")).toBeTruthy();
  expect(tour().queryByRole("button", { name: "Kembali" })).toBeNull();
  fireEvent.click(tour().getByRole("button", { name: "Lanjut" }));
  expect(tour().getByRole("heading").textContent).toBe("Lapor darurat");
  expect(scrolled).toEqual(["door-emergency"]);
  const light = document.querySelector("dialog .ring-4") as HTMLElement;
  expect([light.style.top, light.style.left, light.style.width, light.style.height]).toEqual([
    "94px",
    "14px",
    "212px",
    "92px",
  ]);
  await act(async () => dispatchEvent(new Event("resize")));
  fireEvent.click(tour().getByRole("button", { name: "Kembali" }));
  expect(tour().getByRole("heading").textContent).toBe("Selamat datang di Pantau Bencana");
  for (let n = 0; n < 6; n += 1) fireEvent.click(tour().getByRole("button", { name: "Lanjut" }));
  expect(tour().getByRole("heading").textContent).toBe("Nomor penting");
  expect(scrolled.at(-1)).toBe("door-numbers");
  expect(tour().queryByRole("button", { name: "Lewati tur" })).toBeNull();
  fireEvent.click(tour().getByRole("button", { name: "Selesai" }));
  expect(document.querySelector("dialog")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Lihat tur singkat" }));
  fireEvent.click(tour().getByRole("button", { name: "Lewati tur" }));
  expect(document.querySelector("dialog")).toBeNull();
});

const Served = () => (
  <TextContext.Provider value={text}>
    <HomeHero sent={false} />
  </TextContext.Provider>
);

test("with no script Sigap's example shows, and no tour is offered", () => {
  const Stub = createRoutesStub([{ path: "/", Component: Served }]);
  const page = document.createElement("div");
  page.innerHTML = renderToString(<Stub />);
  expect(page.textContent).toContain("Asisten laporan BNPB");
  expect(page.textContent).not.toContain("Lihat tur singkat");
});
