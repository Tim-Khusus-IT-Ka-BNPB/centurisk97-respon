import type { ApiCall } from "../../src/api/bridge";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { OwnReportDetail } from "../../src/contract/ownReport";
import type { Texts } from "../../src/copy/text";
import { refusedWords } from "./cards";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

export type OwnReportLoad =
  | { readonly kind: "report"; readonly texts: Texts; readonly report: OwnReportDetail }
  | { readonly kind: "refused"; readonly status: number; readonly texts: Texts; readonly envelope: ErrorEnvelope };

// GET /lapor/reports/<ticket>, for the phone or session that sent it.
export async function loadOwnReport(ticketNumber: string, api: ApiCall): Promise<OwnReportLoad> {
  const response = await api("GET", `/reports/${encodeURIComponent(ticketNumber)}`);
  if (response.ok)
    return {
      kind: "report",
      texts: pickTexts(PAGE_TEXTS.ownReport),
      report: (await response.json()) as OwnReportDetail,
    };
  const envelope = (await response.json()) as ErrorEnvelope;
  const { code, copyKey } = envelope.error;
  return {
    kind: "refused",
    status: response.status,
    texts: pickTexts(PAGE_TEXTS.refused, [copyKey, refusedWords(code)]),
    envelope,
  };
}

export type OwnReportActed =
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "render"; readonly status: number; readonly envelope: ErrorEnvelope };

// POST /lapor/reports/<ticket>: "Tambah kabar" opens its draft.
export async function actOnOwnReport(ticketNumber: string, api: ApiCall): Promise<OwnReportActed> {
  const response = await api("POST", `/reports/${encodeURIComponent(ticketNumber)}/follow-ups`);
  if (!response.ok)
    return { kind: "render", status: response.status, envelope: (await response.json()) as ErrorEnvelope };
  const { draftId } = (await response.json()) as { draftId: string };
  return { kind: "redirect", location: `/lapor/report/${draftId}` };
}

const FILE_NAME = /^v(\d{1,3})\.(pdf|docx)$/;

// A document as the API sends it, or the page to go back to when it was refused.
export async function documentOrBack(response: Response, back: string): Promise<Response> {
  if (response.ok) return response;
  return new Response(null, { status: 303, headers: { location: `${back}?refused=document` } });
}

// GET /lapor/reports/<ticket>/v2.pdf.
export async function loadOwnDocument(ticketNumber: string, file: string, api: ApiCall): Promise<Response> {
  const [, version = "0", format = "pdf"] = FILE_NAME.exec(file) ?? [];
  const ticket = encodeURIComponent(ticketNumber);
  return documentOrBack(
    await api("GET", `/reports/${ticket}/documents/${version}/${format}`),
    `/lapor/reports/${ticket}`,
  );
}
