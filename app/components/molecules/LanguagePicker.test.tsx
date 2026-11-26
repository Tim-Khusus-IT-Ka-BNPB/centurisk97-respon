import { screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderPage } from "../../testing/render";
import { LanguagePicker } from "./LanguagePicker";

const offered = vi.hoisted(() => ({
  list: [
    ["id", "Bahasa Indonesia"],
    ["ace", "Bahasa Aceh"],
  ] as [string, string][],
}));
vi.mock("../../../src/copy/languages", () => ({
  get OFFERED() {
    return offered.list;
  },
}));

describe("the language picker", () => {
  test("posts the language picked and the page to come back to", async () => {
    renderPage(<LanguagePicker />, { path: "/lapor/report", entry: "/lapor/report?desa=1108012005" });
    const select = (await screen.findByRole("combobox", { name: "Bahasa" })) as unknown as HTMLSelectElement;
    expect([...select.options].map((option) => [option.value, option.text, option.lang])).toEqual([
      ["id", "Bahasa Indonesia", "id"],
      ["ace", "Bahasa Aceh", "ace"],
    ]);
    expect(select.value).toBe("id");
    const form = select.closest("form") as HTMLFormElement;
    expect([form.method, form.getAttribute("action")]).toEqual(["post", "/lapor/bahasa"]);
    expect((form.elements.namedItem("back") as HTMLInputElement).value).toBe("/lapor/report?desa=1108012005");
    expect(screen.getByRole("button", { name: "Ganti bahasa" })).toBeTruthy();
  });

  test("with only Indonesian there is nothing to pick", async () => {
    offered.list = [["id", "Bahasa Indonesia"]];
    const view = renderPage(<LanguagePicker />, { path: "/lapor/report" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.container.querySelector("form")).toBeNull();
  });
});
