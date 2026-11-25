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
    await renderDesk(<DeskSignIn envelope={refused} />, { path: "/lapor/meja" });
    expect(screen.getByText("Kode masuk tidak dikenal. Periksa kode dari admin, lalu masuk lagi.")).toBeTruthy();
    expect(document.activeElement?.id).toBe("code");
  });

  test("a code on its way shows the sign-in busy", async () => {
    await renderDesk(<DeskSignIn envelope={null} />, { path: "/lapor/meja", action: never });
    fireEvent.change(screen.getByLabelText("Kode masuk"), { target: { value: "kode" } });
    screen.getByRole("button", { name: "Masuk" }).click();
    expect(await screen.findByRole("button", { name: "Memeriksa kode..." })).toBeTruthy();
  });

  test("a limit on signing in names the time; a plain refusal names its fix", async () => {
    const limited = {
      ...envelope("limit.address.staffSignIn", { params: { limit: 30 } }),
      retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" as const },
    };
    const view = await renderDesk(<DeskSignIn envelope={limited} />, { path: "/lapor/meja" });
    expect(screen.getByText(/paling banyak 30 per jam/)).toBeTruthy();
    view.unmount();
    await renderDesk(<DeskSignIn envelope={envelope("request.refused")} />, { path: "/lapor/meja" });
    expect(screen.getByRole("alert").textContent).toContain("Muat ulang halaman");
  });

  test("a refused read says why and leads back to the list; over the limit it names the time", async () => {
    const view = await renderDesk(<DeskRefused envelope={envelope("desk.notAllowed")} />, { path: "/lapor/meja/x" });
    expect(screen.getByText(/belum berhak memakai meja laporan/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kembali ke meja laporan" }).getAttribute("href")).toBe("/lapor/meja");
    view.unmount();
    const limited = {
      ...envelope("limit.desk.read", { params: { limit: 600 } }),
      retryAt: { utc: "2099-01-01T00:00:00.000Z", zone: "WIB" as const },
    };
    await renderDesk(<DeskRefused envelope={limited} />, { path: "/lapor/meja" });
    expect(screen.getByText(/paling banyak 600 pembukaan per jam/)).toBeTruthy();
  });
});
