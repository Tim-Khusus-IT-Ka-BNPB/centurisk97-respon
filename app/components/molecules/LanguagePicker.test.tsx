import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderPage } from "../../testing/render";
import { LanguagePicker } from "./LanguagePicker";

const offered = vi.hoisted(() => ({
  list: [
    ["id", "Bahasa Indonesia"],
    ["jv", "Bahasa Jawa"],
    ["bbc", "Bahasa Batak Toba"],
    ["ace", "Bahasa Aceh"],
  ] as [string, string][],
}));
vi.mock("../../../src/copy/languages", async (actual) => ({
  ...(await actual<typeof import("../../../src/copy/languages")>()),
  get OFFERED() {
    return offered.list;
  },
}));

describe("the language picker", () => {
  test("says the language in use; opened, offers each by its island and posts it with the page to come back to", async () => {
    renderPage(<LanguagePicker />, { path: "/lapor/report", entry: "/lapor/report?desa=1108012005" });
    const summary = (await screen.findByText("Ganti")).closest("summary") as HTMLElement;
    expect(summary.textContent).toContain("Bahasa Indonesia");
    fireEvent.click(summary);
    expect(screen.getByRole("heading", { name: "Pilih bahasa Anda" })).toBeTruthy();
    expect([...document.querySelectorAll("fieldset legend")].map((legend) => legend.textContent)).toEqual([
      "Nasional",
      "Jawa",
      "Sumatra",
    ]);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => [radio.value, radio.checked, radio.closest("label")?.textContent])).toEqual([
      ["id", true, "Indonesia"],
      ["jv", false, "Jawa"],
      ["bbc", false, "Batak Toba"],
      ["ace", false, "Aceh"],
    ]);
    const form = radios[0]?.closest("form") as HTMLFormElement;
    expect([form.method, form.getAttribute("action")]).toEqual(["post", "/lapor/bahasa"]);
    expect((form.elements.namedItem("back") as HTMLInputElement).value).toBe("/lapor/report?desa=1108012005");
    expect(screen.getByRole("button", { name: "Pakai bahasa ini" })).toBeTruthy();
  });

  test("with only Indonesian there is nothing to pick", async () => {
    offered.list = [["id", "Bahasa Indonesia"]];
    const view = renderPage(<LanguagePicker />, { path: "/lapor/report" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.container.querySelector("form")).toBeNull();
  });
});
