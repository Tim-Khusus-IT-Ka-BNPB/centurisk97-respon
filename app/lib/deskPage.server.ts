import type { ApiCall } from "../../src/api/bridge";
import type { DeskGallery, DeskIdentity, DeskMap, DeskQueue, DeskReport, DeskSummary } from "../../src/contract/desk";
import type { ErrorEnvelope } from "../../src/contract/errors";
import { DESK_VIEWS, type DeskFilters, type DeskShown, type DeskTyped, type DeskView } from "./deskTypes";
import type { Texts } from "./text";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

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
      // What the view read: none when the search was refused.
      readonly shown: DeskShown | null;
      // The counts beside the status queues and the hazard chips; null when they cannot be read.
      readonly summary: DeskSummary | null;
      // A refused search: the queue is drawn without results and the field says why.
      readonly envelope: ErrorEnvelope | null;
    };

export type DeskReportLoad =
  | DeskRefusal
  | {
      readonly kind: "report";
      readonly texts: Texts;
      readonly report: DeskReport;
      readonly summary: DeskSummary | null;
    };

const texts = () => pickTexts(PAGE_TEXTS.desk);

// The side menu's counts. A refusal here leaves the menu without them, never the page.
async function summaryOf(api: ApiCall, query: string): Promise<DeskSummary | null> {
  const response = await api("GET", `/desk/summary${query}`);
  return response.ok ? ((await response.json()) as DeskSummary) : null;
}

export function filtersOf(search: URLSearchParams): DeskFilters {
  const page = Number(search.get("page") ?? "1");
  const view = search.get("view") ?? "";
  return {
    view: (DESK_VIEWS as readonly string[]).includes(view) ? (view as DeskView) : "map",
    status: search.get("status") ?? "",
    hazardType: search.get("hazardType") ?? "",
    period: search.get("period") ?? "all",
    ticket: search.get("ticket") ?? "",
    has: search.get("has") ?? "",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

// The API's query for these filters; an empty filter, the view and the first page are left out.
export function queueQuery(filters: DeskFilters): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(filters))
    if (name !== "view" && value !== "" && value !== 1) search.set(name, String(value));
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

async function refusalOf(response: Response): Promise<DeskRefusal> {
  const envelope = (await response.json()) as ErrorEnvelope;
  if (response.status === 401) return { kind: "signIn", texts: texts(), envelope: null };
  return { kind: "refused", status: response.status, texts: texts(), envelope };
}

const VIEW_READS: Readonly<Record<DeskView, readonly string[]>> = {
  map: ["/desk/map", "/desk/reports"],
  list: ["/desk/reports"],
  gallery: ["/desk/photos"],
};

// GET /lapor/meja: the queue for a staff account, or the sign-in form for anyone else.
export async function loadDeskQueue(url: URL, api: ApiCall): Promise<DeskQueueLoad> {
  const filters = filtersOf(url.searchParams);
  // The map and the gallery are not paged.
  const query = queueQuery(filters.view === "list" ? filters : { ...filters, page: 1 });
  const [summary, ...responses] = await Promise.all([
    summaryOf(api, queueQuery({ ...filters, page: 1 })),
    ...VIEW_READS[filters.view].map((path) => api("GET", `${path}${query}`)),
  ]);
  const response = responses.find((one) => !one.ok);
  if (response === undefined) {
    const [body, queue] = await Promise.all(responses.map((one) => one.json()));
    const shown =
      filters.view === "list"
        ? { view: "list" as const, queue: body as DeskQueue }
        : filters.view === "map"
          ? { view: "map" as const, map: body as DeskMap, queue: queue as DeskQueue }
          : { view: "gallery" as const, gallery: body as DeskGallery };
    return { kind: "queue", texts: texts(), filters, shown, summary, envelope: null };
  }
  if (response.status === 422)
    return {
      kind: "queue",
      texts: texts(),
      filters,
      shown: null,
      summary,
      envelope: (await response.json()) as ErrorEnvelope,
    };
  return refusalOf(response);
}

// GET /lapor/meja/<ticket>.
export async function loadDeskReport(ticketNumber: string, api: ApiCall): Promise<DeskReportLoad> {
  const [response, summary] = await Promise.all([
    api("GET", `/desk/reports/${encodeURIComponent(ticketNumber)}`),
    summaryOf(api, ""),
  ]);
  if (response.ok) return { kind: "report", texts: texts(), report: (await response.json()) as DeskReport, summary };
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
const redirectTo = (location: string, response: Response): Extract<DeskActed, { kind: "redirect" }> => {
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

type DeskReportActed =
  | Extract<DeskActed, { kind: "redirect" }>
  // Who reported, drawn on the page that asked and kept nowhere.
  | { readonly kind: "identity"; readonly identity: DeskIdentity }
  | (Extract<DeskActed, { kind: "render" }> & { readonly typed: DeskTyped });

// POST /lapor/meja/<ticket>: the officer moved the ticket or wrote back, named on the page after.
// Asking who reported is answered on the page. With none of these it was opened, so it is logged
// and a new ticket is seen.
export async function actOnDeskReport(ticketNumber: string, form: FormData, api: ApiCall): Promise<DeskReportActed> {
  const ticket = encodeURIComponent(ticketNumber);
  const action = formText(form, "action");
  const typed = { to: formText(form, "to"), note: formText(form, "note"), reply: formText(form, "reply") };
  const saved = action === "status" || action === "reply" ? `?saved=${action}` : "";
  const response =
    action === "status"
      ? await api("POST", `/desk/reports/${ticket}/status`, {
          to: typed.to,
          note: typed.note,
          revision: Number(formText(form, "revision")),
        })
      : action === "reply"
        ? await api("POST", `/desk/reports/${ticket}/replies`, { text: typed.reply })
        : await api("POST", `/desk/reports/${ticket}/${action === "identity" ? "identity" : "view"}`);
  if (!response.ok)
    return { kind: "render", status: response.status, envelope: (await response.json()) as ErrorEnvelope, typed };
  if (action === "identity") return { kind: "identity", identity: (await response.json()) as DeskIdentity };
  return redirectTo(`/lapor/meja/${ticket}${saved}`, response);
}
