import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { renderPage } from "../../testing/render";
import { FailedScreen } from "./FailedScreen";

const PATH = "/reports/LA-231126-01";

// A page whose loader answers as told, one after another.
async function failing(answers: (() => unknown)[]) {
  const asked: number[] = [];
  renderPage(<p>Laporan</p>, {
    path: PATH,
    entry: `${PATH}?saved=sent`,
    errorBoundary: FailedScreen,
    loader: () => {
      asked.push(1);
      return (answers.shift() as () => unknown)();
    },
  });
  const reload = await screen.findByRole("link", { name: "Muat ulang" });
  return { asked, reload };
}

const lost = () => {
  throw new TypeError("Load failed");
};

describe("a page that cannot be shown", () => {
  test("it says so, with the way to call and the way home", async () => {
    const { reload } = await failing([lost]);
    expect(screen.getByRole("alert").textContent).toMatch(/^Halaman belum bisa dibukaSambungan internet/);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/reports/LA-231126-01?saved=sent",
      "/",
      "tel:112",
      "tel:117",
    ]);
    // With no script the link itself asks for the page again.
    expect(reload.getAttribute("href")).toBe("/reports/LA-231126-01?saved=sent");
    expect(screen.getByRole("status").textContent).toBe("");
  });

  test("reloading asks once at a time, says when it is still not there, and shows the page when it is", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { asked, reload } = await failing([
      lost,
      lost,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    ]);
    fireEvent.click(reload);
    expect(await screen.findByText(/^Masih belum bisa dibuka\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Muat ulang" }));
    const busy = await screen.findByRole("link", { name: "Memuat ulang..." });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(busy);
    expect(asked).toHaveLength(3);
    await act(async () => answer(null));
    expect(await screen.findByText("Laporan")).toBeTruthy();
  });
});
