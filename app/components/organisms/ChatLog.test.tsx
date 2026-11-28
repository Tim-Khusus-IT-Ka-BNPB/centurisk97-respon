import { screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { DraftBody } from "../../../src/contract/draft";
import { renderPage } from "../../testing/render";
import { ChatLog } from "./ChatLog";

const at = { utc: "2026-11-29T01:00:00.000Z", zone: "WIB" } as const;
const assistant = (copyKey: string, params: Record<string, string> = {}) =>
  ({ speaker: "assistant", cardKind: null, copyKey, params, at }) as const;

describe("the conversation so far", () => {
  test("what Sigap read is listed back, with how to correct it, and the hazard's safety line follows", async () => {
    const transcript: DraftBody["transcript"] = [
      { speaker: "reporter", textMasked: "banjir sedhadha, omah kelebon telung puluh", at },
      assistant("reply.noted", {
        facts: JSON.stringify([
          { field: "housesFlooded", value: 30 },
          { field: "waterDepth", value: "chest" },
        ]),
      }),
      assistant("safety.flood"),
    ];
    renderPage(<ChatLog transcript={transcript} />);
    const log = within(await screen.findByRole("log"));
    expect(log.getByText("Terima kasih. Ini yang saya catat dari pesan Anda:")).toBeTruthy();
    expect(log.getAllByRole("listitem").map((item) => item.textContent)).toContain("30 rumah terendam");
    expect(log.getByText("Tinggi air: Sedada")).toBeTruthy();
    expect(log.getByText("Bila ada yang keliru, tulis koreksinya di kotak pesan.")).toBeTruthy();
    expect(log.getByText(/^Jauhi arus air/)).toBeTruthy();
  });
});
