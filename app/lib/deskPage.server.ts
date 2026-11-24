import type { ApiCall } from "../../src/api/bridge";
import type { DeskQueue, DeskReport } from "../../src/contract/desk";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Texts } from "./text";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

// The queue's filters as the address carries them, so a filtered view can be linked and reloaded.
export type DeskFilters = {
  readonly status: string;
  readonly hazardType: string;
  readonly period: string;
  readonly ticket: string;
  readonly page: number;
};

// What a desk page shows when its read is refused: sign in, not this account, or a notice.
type DeskRefusal =
  | { readonly kind: "signIn"; readonly texts: Texts; readonly envelope: ErrorEnvelope | null }
  | { readonly kind: "refused"; readonly status: number; readonly texts: Texts; readonly envelope: ErrorEnvelope };

export type DeskQueueLoad =
  | DeskRefusal
  | {
      readonly kind: "queue";
      readonly texts: Texts;
      readonly filters: DeskFilters;
      readonly queue: DeskQueue | null;
      // A refused search: the queue is drawn without results and the field says why.
      readonly envelope: ErrorEnvelope | null;
    };

export type DeskReportLoad =
  | DeskRefusal
  | { readonly kind: "report"; readonly texts: Texts; readonly report: DeskReport };

const texts = () => pickTexts(PAGE_TEXTS.desk);

export function filtersOf(search: URLSearchParams): DeskFilters {
  const page = Number(search.get("page") ?? "1");
  return {
    status: search.get("status") ?? "",
    hazardType: search.get("hazardType") ?? "",
    period: search.get("period") ?? "all",
    ticket: search.get("ticket") ?? "",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

// The API's query for these filters; an empty filter is left out.
export function queueQuery(filters: DeskFilters): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value !== "" && value !== 1) search.set(name, String(value));
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

async function refusalOf(response: Response): Promise<DeskRefusal> {
  const envelope = (await response.json()) as ErrorEnvelope;
  if (response.status === 401) return { kind: "signIn", texts: texts(), envelope: null };
  return { kind: "refused", status: response.status, texts: texts(), envelope };
}

// GET /lapor/meja: the queue for a staff account, or the sign-in form for anyone else.
export async function loadDeskQueue(url: URL, api: ApiCall): Promise<DeskQueueLoad> {
  const filters = filtersOf(url.searchParams);
  const response = await api("GET", `/desk/reports${queueQuery(filters)}`);
  if (response.ok)
    return { kind: "queue", texts: texts(), filters, queue: (await response.json()) as DeskQueue, envelope: null };
  if (response.status === 422)
    return { kind: "queue", texts: texts(), filters, queue: null, envelope: (await response.json()) as ErrorEnvelope };
  return refusalOf(response);
}

// GET /lapor/meja/<ticket>.
export async function loadDeskReport(ticketNumber: string, api: ApiCall): Promise<DeskReportLoad> {
  const response = await api("GET", `/desk/reports/${encodeURIComponent(ticketNumber)}`);
  if (response.ok) return { kind: "report", texts: texts(), report: (await response.json()) as DeskReport };
  return refusalOf(response);
}

export type DeskActed =
  | { readonly kind: "redirect"; readonly location: string; readonly headers: Headers }
  | { readonly kind: "render"; readonly status: number; readonly envelope: ErrorEnvelope };

const formText = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

// The route's cookie goes on with the redirect, so signing in and out reaches the browser.
const redirectTo = (location: string, response: Response): DeskActed => {
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return { kind: "redirect", location, headers };
};

// POST /lapor/meja: sign in with a code, or sign out.
export async function actOnDesk(form: FormData, api: ApiCall): Promise<DeskActed> {
  const response =
    formText(form, "action") === "signOut"
      ? await api("DELETE", "/desk/session")
      : await api("POST", "/desk/session", { code: formText(form, "code") });
  if (response.ok) return redirectTo("/lapor/meja", response);
  return { kind: "render", status: response.status, envelope: (await response.json()) as ErrorEnvelope };
}

// POST /lapor/meja/<ticket>: the officer opened it, so it is logged and a new ticket is seen.
export async function actOnDeskReport(ticketNumber: string, api: ApiCall): Promise<DeskActed> {
  const path = `/lapor/meja/${encodeURIComponent(ticketNumber)}`;
  const response = await api("POST", `/desk/reports/${encodeURIComponent(ticketNumber)}/view`);
  if (response.ok) return redirectTo(path, response);
  return { kind: "render", status: response.status, envelope: (await response.json()) as ErrorEnvelope };
}
