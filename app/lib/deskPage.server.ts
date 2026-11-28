import type { ApiCall } from "../../src/api/bridge";
import type {
  DeskGallery,
  DeskIdentity,
  DeskMap,
  DeskQueue,
  DeskReport,
  DeskResponse,
  DeskSummary,
  DeskTrackingLink,
} from "../../src/contract/desk";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { WarningControl } from "../../src/contract/warnings";
import type { Texts } from "../../src/copy/text";
import { MISSING_STATUSES, type MissingStatus } from "../../src/domain/missingPerson";
import {
  DESK_VIEWS,
  type DeskFilters,
  type DeskShown,
  type DeskTyped,
  type DeskView,
  type OfficerNumber,
} from "./deskTypes";
import type { DeskMissingOne } from "./missingTypes";
import { documentOrBack } from "./ownReportPage.server";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

// What a desk page shows when its read is refused: sign in, not this account, or a notice.
type DeskRefusal =
  // signInUrl: where auth signs staff in, when it does; null where staff type a seeded code.
  | {
      readonly kind: "signIn";
      readonly texts: Texts;
      readonly envelope: ErrorEnvelope | null;
      readonly signInUrl: string | null;
    }
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
  if (response.status === 401)
    return { kind: "signIn", texts: texts(), envelope: null, signInUrl: response.headers.get("x-sign-in") };
  return { kind: "refused", status: response.status, texts: texts(), envelope };
}

const VIEW_READS: Readonly<Record<DeskView, readonly string[]>> = {
  map: ["/desk/map", "/desk/reports"],
  list: ["/desk/reports"],
  gallery: ["/desk/photos"],
};

// GET /desk: the queue for a staff account, or the sign-in form for anyone else.
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
  // A refused search keeps the menu, its counts and the alarm: they are read without the search.
  if (response.status === 422)
    return {
      kind: "queue",
      texts: texts(),
      filters,
      shown: null,
      summary: await summaryOf(api, queueQuery({ ...filters, ticket: "", page: 1 })),
      envelope: (await response.json()) as ErrorEnvelope,
    };
  return refusalOf(response);
}

// GET /desk/<ticket>.
export async function loadDeskReport(ticketNumber: string, api: ApiCall): Promise<DeskReportLoad> {
  const [response, summary] = await Promise.all([
    api("GET", `/desk/reports/${encodeURIComponent(ticketNumber)}`),
    summaryOf(api, ""),
  ]);
  if (response.ok) return { kind: "report", texts: texts(), report: (await response.json()) as DeskReport, summary };
  return refusalOf(response);
}

export type DeskResponseLoad =
  | DeskRefusal
  | {
      readonly kind: "response";
      readonly texts: Texts;
      readonly response: DeskResponse;
      readonly summary: DeskSummary | null;
      // Null when it cannot be read: the rest of the page still shows.
      readonly warnings: WarningControl | null;
    };

// GET /desk/response: how fast each agency answered a month's reports.
export async function loadDeskResponse(month: string | null, api: ApiCall): Promise<DeskResponseLoad> {
  const query = month === null ? "" : `?month=${encodeURIComponent(month)}`;
  const [response, summary, warnings] = await Promise.all([
    api("GET", `/desk/response${query}`),
    summaryOf(api, ""),
    api("GET", "/desk/warnings"),
  ]);
  if (!response.ok) return refusalOf(response);
  return {
    kind: "response",
    texts: texts(),
    response: (await response.json()) as DeskResponse,
    summary,
    warnings: warnings.ok ? ((await warnings.json()) as WarningControl) : null,
  };
}

// POST /desk/response: pause or resume the warnings, then the page again, as it was.
export async function pauseWarnings(form: FormData, api: ApiCall): Promise<boolean> {
  return (await api("POST", "/desk/warnings", { paused: formText(form, "paused") === "1" })).ok;
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

// POST /desk: sign in with a code, or sign out. Signing out from the report start goes
// back there; no other place is taken, so the field cannot send anyone off the site.
export async function actOnDesk(form: FormData, api: ApiCall): Promise<DeskActed> {
  const response =
    formText(form, "action") === "signOut"
      ? await api("DELETE", "/desk/session")
      : await api("POST", "/desk/session", { code: formText(form, "code") });
  const next = formText(form, "next") === "/report" ? "/report" : "/desk";
  if (response.ok) return redirectTo(next, response);
  return { kind: "render", status: response.status, envelope: (await response.json()) as ErrorEnvelope };
}

// A form posted: kept and led on, or drawn again with what was typed.
type DeskPosted =
  | Extract<DeskActed, { kind: "redirect" }>
  | (Extract<DeskActed, { kind: "render" }> & { readonly typed: DeskTyped });

type DeskReportActed =
  | DeskPosted
  // Nothing to show but the page as it is now.
  | { readonly kind: "done" }
  // Who reported, drawn on the page that asked and kept nowhere.
  | { readonly kind: "identity"; readonly identity: DeskIdentity }
  // A BPBD officer's number, the same way.
  | { readonly kind: "officerNumber"; readonly officer: OfficerNumber }
  // The report's tracking link, the same way.
  | { readonly kind: "trackingLink"; readonly link: string };

// The photo, the officer's reading and whether it was forwarded, as the API takes them.
function proofForm(form: FormData): FormData {
  const proof = new FormData();
  for (const name of ["photo", "lat", "lon", "accuracy", "readAt", "forwarded"]) {
    const value = form.get(name);
    if (value !== null) proof.set(name, value);
  }
  return proof;
}

// What each of the page's forms posts, by its action. Anything else is the report being opened, so
// it is logged and a new ticket is seen.
function deskPost(form: FormData): readonly [path: string, body?: unknown] {
  const text = (name: string) => formText(form, name);
  const revision = Number(text("revision"));
  const done = { actions: form.getAll("actions"), otherAction: text("otherAction") };
  switch (text("action")) {
    case "status":
      return ["status", { to: text("to"), note: text("note"), revision, ...done }];
    case "reply":
      return ["replies", { text: text("reply") }];
    case "check":
      return [
        "checks",
        {
          result: text("result"),
          note: text("checkNote"),
          boxes: Object.fromEntries(
            [...form.keys()].filter((name) => name.startsWith("box.")).map((name) => [name.slice(4), text(name)]),
          ),
          revision,
        },
      ];
    case "actions":
      return ["actions", done];
    case "proof":
      return ["proofs", proofForm(form)];
    case "identity":
      return ["identity"];
    case "trackingLink":
      return ["tracking-link"];
    case "officerNumber":
      return [`officers/${encodeURIComponent(text("profileId"))}/number`];
    case "take":
      return ["take"];
    case "proofPublic":
      return [`proofs/${encodeURIComponent(text("proofId"))}/public`, { public: text("public") === "1" }];
    case "release":
      return ["event/release"];
    case "today":
      return ["today", { pulled: text("pulled") === "1" }];
    case "openCase":
      return ["case"];
    case "commentShown":
      return [
        `comments/${encodeURIComponent(text("commentId"))}`,
        { shown: text("shown") === "1", reason: text("reason") },
      ];
    case "figure":
      return [
        `comment-figures/${encodeURIComponent(text("figureId"))}`,
        {
          accept: text("accept") === "1",
          reason: text("reason"),
          ...(form.has("field") ? { field: text("field") } : {}),
        },
      ];
    default:
      return ["view"];
  }
}

const typedIn = (form: FormData): DeskTyped => ({
  values: Object.fromEntries([...form].flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : []))),
  actions: form.getAll("actions").map(String),
});

// A form that turns something one way or the other names which way on the page after: [off, on].
const TOGGLE_FIELD: Readonly<Record<string, string>> = {
  today: "pulled",
  commentShown: "shown",
  figure: "accept",
};
const TOGGLED: Readonly<Record<string, readonly [string, string]>> = {
  today: ["todayRestored", "todayPulled"],
  commentShown: ["commentHidden", "commentShown"],
  figure: ["figureRejected", "figureAccepted"],
};

// POST /desk/<ticket>: one of the page's forms. A change kept is named on the page after;
// asking who reported is answered on the page itself.
export async function actOnDeskReport(ticketNumber: string, form: FormData, api: ApiCall): Promise<DeskReportActed> {
  const ticket = encodeURIComponent(ticketNumber);
  const [path, body] = deskPost(form);
  const response = await api("POST", `/desk/reports/${ticket}/${path}`, body);
  if (!response.ok) {
    const envelope = (await response.json()) as ErrorEnvelope;
    return { kind: "render", status: response.status, envelope, typed: typedIn(form) };
  }
  if (path === "identity") return { kind: "identity", identity: (await response.json()) as DeskIdentity };
  if (path === "tracking-link")
    return { kind: "trackingLink", link: ((await response.json()) as DeskTrackingLink).link };
  if (path.startsWith("officers/")) return { kind: "officerNumber", officer: (await response.json()) as OfficerNumber };
  // A file opened is gone to at once.
  if (path === "case") return redirectTo(`/cases/${((await response.json()) as { fileId: string }).fileId}`, response);
  if (form.get("action") === "opened") return { kind: "done" };
  const action = form.get("action");
  const saved =
    action === "proofPublic"
      ? formText(form, "public") === "1"
        ? "proofShown"
        : "proofHidden"
      : action === "release"
        ? "released"
        : (TOGGLED[String(action)]?.[formText(form, TOGGLE_FIELD[String(action)] as string) === "1" ? 1 : 0] ?? path);
  return redirectTo(`/desk/${ticket}${path === "view" ? "" : `?saved=${saved}`}`, response);
}

// POST /desk/<ticket>/documents: a version as a file.
export async function downloadDeskDocument(ticketNumber: string, form: FormData, api: ApiCall): Promise<Response> {
  const ticket = encodeURIComponent(ticketNumber);
  const body = { version: formText(form, "version"), format: formText(form, "format") };
  const response = await api("POST", `/desk/reports/${ticket}/documents`, body);
  return documentOrBack(response, `/desk/${ticket}`);
}

// POST /desk/response: the weekly counts as a file, or the page again with why not.
export async function downloadAggregates(api: ApiCall): Promise<Response> {
  const response = await api("POST", "/desk/aggregates", {});
  if (response.ok) return response;
  return new Response(null, { status: 303, headers: { location: "/desk/response?refused=aggregates" } });
}

export type DeskMissingLoad =
  | DeskRefusal
  | {
      readonly kind: "missing";
      readonly texts: Texts;
      readonly status: MissingStatus | null;
      readonly items: readonly DeskMissingOne[];
      readonly summary: DeskSummary | null;
      readonly saved: boolean;
    };

const isMissingStatus = (value: string | null): value is MissingStatus =>
  (MISSING_STATUSES as readonly (string | null)[]).includes(value);

// GET /desk/missing: the region's missing persons, each with its history, by status.
export async function loadDeskMissing(url: URL, api: ApiCall): Promise<DeskMissingLoad> {
  const asked = url.searchParams.get("status");
  const status = isMissingStatus(asked) ? asked : null;
  const [response, summary] = await Promise.all([
    api("GET", `/desk/missing${status === null ? "" : `?status=${status}`}`),
    summaryOf(api, ""),
  ]);
  if (!response.ok) return refusalOf(response);
  const { items } = (await response.json()) as { items: DeskMissingOne[] };
  return { kind: "missing", texts: texts(), status, items, summary, saved: url.searchParams.has("saved") };
}

// POST /desk/missing: one person's new status, with its note.
export async function actOnDeskMissing(form: FormData, api: ApiCall, url: URL): Promise<DeskPosted> {
  const id = encodeURIComponent(formText(form, "id"));
  const response = await api("POST", `/desk/missing/${id}/status`, {
    to: formText(form, "to"),
    note: formText(form, "note"),
  });
  const status = url.searchParams.get("status");
  const back = `/desk/missing?${isMissingStatus(status) ? `status=${status}&` : ""}saved=1#orang-${id}`;
  if (response.ok) return redirectTo(back, response);
  const envelope = (await response.json()) as ErrorEnvelope;
  return { kind: "render", status: response.status, envelope, typed: typedIn(form) };
}
