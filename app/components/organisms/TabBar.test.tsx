import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderPage } from "../../testing/render";
import { TabBar } from "./TabBar";

const bar = async () => screen.findByRole("navigation", { name: "Menu utama" });
const here = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.getAttribute("href"));

test("the tab bar names five places, each with its label, and marks the home only on itself", async () => {
  renderPage(<TabBar />, { path: "/" });
  const nav = await bar();
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["Beranda", "/"],
    ["Alun-alun", "/feed"],
    ["Info daerah", "/info"],
    ["Nomor penting", "/numbers"],
    ["Bantuan", "/help"],
  ]);
  expect(here(nav)).toEqual(["/"]);
  // Phones and tablets only, stepping aside while a field is typed in.
  expect(nav.className).toContain("lg:hidden");
  expect(nav.className).toContain("hide-while-typing");
});

test("a page under one of them marks that one", async () => {
  renderPage(<TabBar />, { path: "/feed", entry: "/feed?hazard=flood" });
  expect(here(await bar())).toEqual(["/feed"]);
});
