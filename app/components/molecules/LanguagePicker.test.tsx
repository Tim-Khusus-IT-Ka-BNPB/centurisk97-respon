import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { renderPage } from "../../testing/render";
import { LanguageChooser, LanguageLink, LanguagePicker } from "./LanguagePicker";

const offered = vi.hoisted(() => ({
  list: [
    ["id", "Bahasa Indonesia"],
    ["en", "English"],
    ["jv", "Bahasa Jawa"],
    ["su", "Bahasa Sunda"],
    ["mad", "Bahasa Madura"],
    ["bug", "Bahasa Bugis"],
    ["mak", "Bahasa Makassar"],
    ["sda", "Bahasa Toraja"],
    ["gor", "Bahasa Gorontalo"],
  ] as [string, string][],
}));
vi.mock("../../../src/copy/languages", async (actual) => ({
  ...(await actual<typeof import("../../../src/copy/languages")>()),
  get OFFERED() {
    return offered.list;
  },
}));

describe("the language chooser", () => {
  test("offers each language by its island, in as many columns as fit it, and keeps the one picked", async () => {
    renderPage(<LanguageChooser back="/report?village=1108012005" onClose={<button type="button">x</button>} />, {
      path: "/report",
    });
    expect(await screen.findByRole("heading", { name: "Pilih bahasa Anda" })).toBeTruthy();
    const groups = [...document.querySelectorAll("fieldset")];
    expect(groups.map((group) => group.querySelector("legend")?.textContent)).toEqual(["Nasional", "Jawa", "Sulawesi"]);
    expect(groups.map((group) => (group.querySelector("div") as HTMLElement).className)).toEqual([
      expect.not.stringContaining("sm:grid-cols"),
      expect.stringContaining("sm:grid-cols-3"),
      expect.stringContaining("sm:grid-cols-4"),
    ]);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(
      radios.slice(0, 3).map((radio) => [radio.value, radio.checked, radio.closest("label")?.textContent]),
    ).toEqual([
      ["id", true, "Indonesia"],
      ["en", false, "English"],
      ["jv", false, "Jawa"],
    ]);
    const form = radios[0]?.closest("form") as HTMLFormElement;
    expect([form.method, form.getAttribute("action")]).toEqual(["post", "/language"]);
    expect((form.elements.namedItem("back") as HTMLInputElement).value).toBe("/report?village=1108012005");
    expect(await screen.findByRole("button", { name: "Lanjut dalam Bahasa Indonesia" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("English"));
    expect(screen.getByRole("button", { name: "Lanjut dalam English" })).toBeTruthy();
  });
});

describe("the language picker", () => {
  test("says the language in use and opens the chooser in a dialog, or as its page with no dialog", async () => {
    renderPage(<LanguagePicker />, { path: "/report", entry: "/report?village=1108012005" });
    const open = await screen.findByRole("link", { name: /Bahasa Indonesia/ });
    expect(open.getAttribute("href")).toBe("/language?back=%2Freport%3Fvillage%3D1108012005");
    const dialog = document.querySelector("dialog") as HTMLDialogElement;
    // jsdom has no dialog: the link is followed as it is.
    expect(fireEvent.click(open)).toBe(true);
    const shown = vi.fn();
    dialog.showModal = shown;
    expect(fireEvent.click(open)).toBe(false);
    expect(shown).toHaveBeenCalledOnce();
    expect(
      within(dialog).getByRole("button", { name: "Tutup", hidden: true }).closest("form")?.getAttribute("method"),
    ).toBe("dialog");
  });

  test("in a phone's menu it names the language and opens the chooser as its page", async () => {
    renderPage(<LanguageLink className="menu" />, { path: "/feed" });
    const open = await screen.findByRole("link", { name: "Bahasa: Bahasa Indonesia. Ganti bahasa" });
    expect([open.getAttribute("href"), open.textContent]).toEqual(["/language?back=%2Ffeed", "Bahasa Indonesia"]);
  });

  test("with only Indonesian there is nothing to pick", async () => {
    offered.list = [["id", "Bahasa Indonesia"]];
    for (const picker of [<LanguagePicker key="bar" />, <LanguageLink key="menu" className="menu" />]) {
      const view = renderPage(picker, { path: "/report" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(view.container.querySelector("a")).toBeNull();
      view.unmount();
    }
  });
});
