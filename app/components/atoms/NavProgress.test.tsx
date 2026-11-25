import { act, fireEvent, screen } from "@testing-library/react";
import { Link } from "react-router";
import { describe, expect, test } from "vitest";
import { never, renderPage } from "../../testing/render";
import { NavProgress } from "./NavProgress";

describe("the line at the top", () => {
  test("shows while the next page is on its way, never before", async () => {
    let first = true;
    renderPage(
      <>
        <NavProgress />
        <Link to="/here?next">Lanjut</Link>
      </>,
      {
        path: "/here",
        loader: () => {
          if (!first) return never();
          first = false;
          return null;
        },
      },
    );
    const link = await screen.findByRole("link", { name: "Lanjut" });
    expect(document.querySelector(".nav-progress")).toBeNull();
    await act(async () => fireEvent.click(link));
    expect(document.querySelector(".nav-progress")?.getAttribute("aria-hidden")).toBe("true");
  });
});
