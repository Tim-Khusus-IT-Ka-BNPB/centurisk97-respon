import { screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { never, renderPage } from "../../testing/render";
import { ThemeSwitch } from "./ThemeSwitch";

describe("theme switch", () => {
  test("names the theme a press brings, and posts it with the page to return to", async () => {
    const posted = vi.fn(never);
    renderPage(<ThemeSwitch withLabel />, { path: "/lapor/theme", entry: "/lapor/theme?view=map", action: posted });
    const button = await screen.findByRole("button", { name: "Pakai tema gelap" });
    expect(button.getAttribute("value")).toBe("dark");
    expect(button.textContent).toBe("Pakai tema gelap");
    expect((document.querySelector('input[name="back"]') as HTMLInputElement).value).toBe("/lapor/theme?view=map");
    button.click();
    // While the choice is on its way the switch already shows it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Pakai tema terang" })).toBeTruthy());
    expect(posted).toHaveBeenCalledTimes(1);
  });

  test("without a label it is an icon named in words", async () => {
    renderPage(<ThemeSwitch />, { path: "/lapor" });
    const button = await screen.findByRole("button", { name: "Pakai tema gelap" });
    expect(button.textContent).toBe("");
  });
});
