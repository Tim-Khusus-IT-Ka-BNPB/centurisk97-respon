import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Button } from "./Button";

describe("the button", () => {
  test("a click goes through while idle and is ignored while busy", () => {
    const clicked = vi.fn();
    const { rerender } = render(
      <Button type="button" onClick={clicked}>
        Simpan
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(clicked).toHaveBeenCalledTimes(1);
    rerender(
      <Button type="button" onClick={clicked} busyLabel="Menyimpan">
        Simpan
      </Button>,
    );
    const busy = screen.getByRole("button", { name: "Menyimpan" });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(busy);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test("with no handler a click just submits, and its own aria-disabled is kept", () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <Button aria-disabled>Kirim</Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Kirim" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("type")).toBe("submit");
  });
});
