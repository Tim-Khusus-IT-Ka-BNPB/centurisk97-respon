import { describe, expect, test } from "vitest";
import type { ApiCall } from "../../src/api/bridge";
import { envelope } from "../../src/api/envelope";
import { OWN_REPORT } from "../testing/ownReport";
import { downloadDeskDocument } from "./deskPage.server";
import { actOnOwnReport, loadOwnDocument, loadOwnReport } from "./ownReportPage.server";

type Call = { method: string; path: string; body: unknown };

function fakeApi(answer: () => Response) {
  const calls: Call[] = [];
  const api: ApiCall = async (method, path, body) => {
    calls.push({ method, path, body });
    return answer();
  };
  return { api, calls };
}

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.append(name, value);
  return data;
};

describe("the reporter's own report page", () => {
  test("is read by its ticket; a refusal keeps its words", async () => {
    const { api, calls } = fakeApi(() => Response.json(OWN_REPORT));
    expect(await loadOwnReport("LA-1/2", api)).toMatchObject({ kind: "report", report: OWN_REPORT });
    expect(calls).toEqual([{ method: "GET", path: "/reports/LA-1%2F2", body: undefined }]);
    const refused = await loadOwnReport(
      "LA-1",
      fakeApi(() => Response.json(envelope("report.notFound"), { status: 404 })).api,
    );
    expect(refused).toMatchObject({ kind: "refused", status: 404 });
    expect(refused.texts["error.draft.notFound.title"]).toBe("Laporan tidak ditemukan");
  });

  test("news opens its draft; a refusal is drawn on the page", async () => {
    const draftId = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
    const started = fakeApi(() => Response.json({ draftId }, { status: 201 }));
    expect(await actOnOwnReport("LA-1", started.api)).toEqual({
      kind: "redirect",
      location: `/lapor/report/${draftId}`,
    });
    expect(started.calls).toEqual([{ method: "POST", path: "/reports/LA-1/follow-ups", body: undefined }]);
    const closed = envelope("followUp.closed");
    expect(await actOnOwnReport("LA-1", fakeApi(() => Response.json(closed, { status: 409 })).api)).toEqual({
      kind: "render",
      status: 409,
      envelope: closed,
    });
  });

  test("a file is passed on as it came; a refused one leads back to the page with the reason", async () => {
    const file = fakeApi(() => new Response("isi", { headers: { "content-type": "application/pdf" } }));
    const answer = await loadOwnDocument("LA-1", "v12.docx", file.api);
    expect([answer.status, await answer.text()]).toEqual([200, "isi"]);
    expect(file.calls[0]?.path).toBe("/reports/LA-1/documents/12/docx");

    const refused = fakeApi(() => Response.json(envelope("report.notFound"), { status: 404 }));
    const back = await loadOwnDocument("LA-1", "semua.zip", refused.api);
    expect([back.status, back.headers.get("location")]).toEqual([303, "/lapor/reports/LA-1?refused=document"]);
    expect(refused.calls[0]?.path).toBe("/reports/LA-1/documents/0/pdf");
  });

  test("staff's copy is posted, and a refused one leads back to the desk's page", async () => {
    const file = fakeApi(() => new Response("isi"));
    await downloadDeskDocument("LA-1", form({ version: "2", format: "pdf" }), file.api);
    expect(file.calls).toEqual([
      { method: "POST", path: "/desk/reports/LA-1/documents", body: { version: "2", format: "pdf" } },
    ]);
    const refused = fakeApi(() => Response.json(envelope("desk.reportNotFound"), { status: 404 }));
    const back = await downloadDeskDocument("LA-1", form({}), refused.api);
    expect(back.headers.get("location")).toBe("/lapor/meja/LA-1?refused=document");
  });
});
