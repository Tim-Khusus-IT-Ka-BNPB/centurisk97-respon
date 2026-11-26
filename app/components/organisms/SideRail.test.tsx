import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderPage } from "../../testing/render";
import { SideRail } from "./SideRail";

const here = () =>
  within(screen.getByRole("navigation", { name: "Menu" }))
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("href"));

test("the side rail names each page and marks the one open, the home with or without its slash", async () => {
  renderPage(<SideRail />, { path: "/lapor/" });
  await screen.findByRole("navigation", { name: "Menu" });
  expect(
    within(screen.getByRole("navigation", { name: "Menu" }))
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["Beranda", "/lapor"],
    ["Alun-alun", "/lapor/feed"],
    ["Info daerah", "/lapor/info"],
    ["Nomor penting", "/lapor/nomor-penting"],
    ["Bantuan", "/lapor/help"],
    ["Tentang", "/lapor/about"],
  ]);
  expect(here()).toEqual(["/lapor"]);
});

test("a page under one of them marks that one", async () => {
  renderPage(<SideRail />, { path: "/lapor/feed", entry: "/lapor/feed?hazard=flood" });
  await screen.findByRole("navigation", { name: "Menu" });
  expect(here()).toEqual(["/lapor/feed"]);
});
