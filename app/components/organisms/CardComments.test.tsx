import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { never, renderPage } from "../../testing/render";
import { CardComments } from "./CardComments";

const COMMENTS = [
  {
    id: "0123456789abcdef",
    text: "Air mulai surut\ndi dusun kami",
    at: { utc: "2026-11-24T03:00:00.000Z", zone: "WIB" as const },
  },
];
const envelope = (
  code: ErrorEnvelope["error"]["code"],
  copyKey: string,
  fields: ErrorEnvelope["fields"] = [],
): ErrorEnvelope => ({
  error: { code, copyKey, params: { limit: 10 } },
  fields,
  retryAt: { utc: new Date(Date.now() + 20 * 60_000).toISOString(), zone: "WIB" },
  draft: null,
});
const draw = (props: Partial<Parameters<typeof CardComments>[0]> = {}) =>
  renderPage(<CardComments comments={COMMENTS} mayComment envelope={null} typed="" done={null} {...props} />, {
    path: "/feed/0123456789abcdef",
    action: never,
  });

describe("the residents' news on a card", () => {
  test("shows each as Warga with its time, reportable, and a box to write one", async () => {
    draw();
    const item = (await screen.findAllByRole("listitem"))[0] as HTMLElement;
    expect(within(item).getByText("Warga")).toBeTruthy();
    expect(within(item).getByText(/Air mulai surut/).textContent).toBe("Air mulai surut\ndi dusun kami");
    const report = within(item).getByRole("button", {
      name: "Laporkan kabar ini sebagai tidak pantas atau tidak benar",
    });
    const form = report.closest("form") as HTMLFormElement;
    expect((form.elements.namedItem("commentId") as HTMLInputElement).value).toBe("0123456789abcdef");
    fireEvent.click(report);
    expect(await screen.findByText("Mengirim...")).toBeTruthy();
  });

  test("writing one says so while it is sent, and a refused one is named under the box", async () => {
    const view = draw({
      envelope: envelope("request.invalidFields", "error.request.invalidFields", [
        { fieldId: "text", copyKey: "fieldError.comment.rude", params: {} },
      ]),
      typed: "dasar goblok",
    });
    const box = await screen.findByRole("textbox", { name: "Tulis kabar" });
    expect((box as HTMLTextAreaElement).value).toBe("dasar goblok");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Komentar memuat kata kasar. Tulis ulang dengan kata yang sopan.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kirim kabar" }));
    expect(await screen.findByText("Mengirim...")).toBeTruthy();
    view.unmount();
  });

  test("tells what was just done, a limit, or another refusal", async () => {
    const sent = draw({ done: "sent" });
    expect((await screen.findByRole("status")).textContent).toBe("Kabar Anda sudah tampil di bawah.");
    sent.unmount();
    const reported = draw({ done: "reported" });
    expect((await screen.findByRole("status")).textContent).toMatch(/^Terima kasih, laporan Anda dicatat/);
    reported.unmount();
    const limited = draw({ envelope: envelope("limit.comment.hour", "limit.comment.hour") });
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Anda sudah mengirim 10 komentar dalam satu jam/);
    limited.unmount();
    draw({ envelope: envelope("comments.own", "error.comments.own") });
    expect((await screen.findByRole("alert")).textContent).toBe("Komentar Anda sendiri tidak bisa dilaporkan.");
  });

  test("with none yet, and for someone not known here, leads to reporting first", async () => {
    const reading = draw({ mayComment: false });
    expect(await screen.findByText("Warga")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Laporkan/ })).toBeNull();
    reading.unmount();
    draw({ comments: [], mayComment: false });
    expect(await screen.findByText("Belum ada kabar dari warga.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Laporkan kejadian" }).getAttribute("href")).toBe("/report");
  });
});
