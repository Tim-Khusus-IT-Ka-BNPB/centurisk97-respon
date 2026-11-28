import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { envelope } from "../../../../src/api/envelope";
import { renderDesk } from "../../../testing/desk";
import { never } from "../../../testing/render";
import { DeskRefused, DeskSignIn } from "./DeskSignIn";

describe("signing in and refusals", () => {
  test("the code field with its fix, focused", async () => {
    const refused = {
      ...envelope("request.invalidFields"),
      fields: [{ fieldId: "code", copyKey: "fieldError.staffCode.unknown", params: {} }],
    };
    await renderDesk(<DeskSignIn envelope={refused} />, { path: "/desk" });
    expect(screen.getByText("Kode masuk tidak dikenal. Periksa kode dari admin, lalu masuk lagi.")).toBeTruthy();
    expect(document.activeElement?.id).toBe("code");
  });

  test("a code on its way shows the sign-in busy", async () => {
    await renderDesk(<DeskSignIn envelope={null} />, { path: "/desk", action: never });
    fireEvent.change(screen.getByLabelText("Kode masuk"), { target: { value: "kode" } });
    screen.getByRole("button", { name: "Masuk" }).click();
    expect(await screen.findByRole("button", { name: "Memeriksa kode..." })).toBeTruthy();
  });

  test("a limit on signing in names the time; a plain refusal names its fix", async () => {
    const limited = {
      ...envelope("limit.address.staffSignIn", { params: { limit: 30 } }),
      retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" as const },
    };
    const view = await renderDesk(<DeskSignIn envelope={limited} />, { path: "/desk" });
    expect(screen.getByText(/paling banyak 30 per jam/)).toBeTruthy();
    view.unmount();
    await renderDesk(<DeskSignIn envelope={envelope("request.refused")} />, { path: "/desk" });
    expect(screen.getByRole("alert").textContent).toContain("Muat ulang halaman");
  });

  test("where auth signs staff in: one button there, which brings them back to this page", async () => {
    await renderDesk(<DeskSignIn envelope={null} signInUrl="/api/auth/sign-in" />, {
      path: "/desk/response",
      entry: "/desk/response?period=7d",
    });
    const button = screen.getByRole("link", { name: "Masuk dengan akun centurisk97" });
    expect(button.getAttribute("href")).toBe(
      `/api/auth/sign-in?back=${encodeURIComponent("/desk/response?period=7d")}`,
    );
    expect(screen.queryByLabelText("Kode masuk")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("back from auth without the desk: why, and the button returns to the page without it", async () => {
    const view = await renderDesk(<DeskSignIn envelope={null} signInUrl="/api/auth/sign-in" />, {
      path: "/desk",
      entry: "/desk?signIn=noAccess",
    });
    expect(screen.getByText(/belum punya akses ke meja laporan/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Masuk dengan akun centurisk97" }).getAttribute("href")).toBe(
      "/api/auth/sign-in?back=%2Fdesk",
    );
    view.unmount();
    await renderDesk(<DeskSignIn envelope={null} signInUrl="/api/auth/sign-in" />, {
      path: "/desk",
      entry: "/desk?signIn=failed",
    });
    expect(screen.getByText("Masuk tidak berhasil. Coba sekali lagi.")).toBeTruthy();
  });

  test("a refused read says why and leads back to the list; over the limit it names the time", async () => {
    const view = await renderDesk(<DeskRefused envelope={envelope("desk.notAllowed")} />, { path: "/desk/x" });
    expect(screen.getByText(/belum berhak memakai meja laporan/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke meja laporan" }).getAttribute("href")).toBe("/desk");
    view.unmount();
    const limited = {
      ...envelope("limit.desk.read", { params: { limit: 600 } }),
      retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" as const },
    };
    await renderDesk(<DeskRefused envelope={limited} />, { path: "/desk" });
    expect(screen.getByText(/paling banyak 600 pembukaan per jam/)).toBeTruthy();
  });
});
