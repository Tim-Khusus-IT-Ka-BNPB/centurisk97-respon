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
  renderPage(<SideRail />, { path: "/" });
  await screen.findByRole("navigation", { name: "Menu" });
  expect(
    within(screen.getByRole("navigation", { name: "Menu" }))
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["Beranda", "/"],
    ["Alun-alun", "/feed"],
    ["Info daerah", "/info"],
    ["Nomor penting", "/numbers"],
    ["Bantuan", "/help"],
    ["Tentang", "/about"],
  ]);
  expect(here()).toEqual(["/"]);
});

test("a page under one of them marks that one", async () => {
  renderPage(<SideRail />, { path: "/feed", entry: "/feed?hazard=flood" });
  await screen.findByRole("navigation", { name: "Menu" });
  expect(here()).toEqual(["/feed"]);
});
