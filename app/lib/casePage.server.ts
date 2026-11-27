import type { ApiCall } from "../../src/api/bridge";
import type { CaseView } from "../../src/contract/cases";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Texts } from "../../src/copy/text";
import { CASE_KINDS, CASE_SPEC, type CaseKind } from "../../src/domain/caseSpec";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

// The BPBD's follow-up file pages (M09): the team screen, its forms, and the link a member joins by.

const texts = () => pickTexts(PAGE_TEXTS.desk);

export type CaseTab = { readonly kind: CaseKind; readonly editing: string | null };

export type CaseLoad =
  | { readonly kind: "file"; readonly texts: Texts; readonly view: CaseView; readonly tab: CaseTab }
  | { readonly kind: "signIn"; readonly texts: Texts }
  | { readonly kind: "refused"; readonly status: number; readonly texts: Texts; readonly envelope: ErrorEnvelope };

export function tabOf(search: URLSearchParams): CaseTab {
  const asked = search.get("jenis");
  return {
    kind: CASE_KINDS.find((one) => one === asked) ?? "house",
    editing: /^[0-9a-f]{16}$/.test(search.get("ubah") ?? "") ? (search.get("ubah") as string) : null,
  };
}

// GET /lapor/data/<file>: the file as its reader may see it, or why not.
export async function loadCase(fileId: string, url: URL, api: ApiCall): Promise<CaseLoad> {
  const response = await api("GET", `/cases/${encodeURIComponent(fileId)}`);
  if (response.ok)
    return { kind: "file", texts: texts(), view: (await response.json()) as CaseView, tab: tabOf(url.searchParams) };
  if (response.status === 401) return { kind: "signIn", texts: texts() };
  return {
    kind: "refused",
    status: response.status,
    texts: texts(),
    envelope: (await response.json()) as ErrorEnvelope,
  };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

// The form's values for a record of this kind, as the API reads them: a yes or no as a boolean, a
// list as its ticks, an empty box left out.
export function recordValues(kind: CaseKind, form: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const { id, field } of CASE_SPEC[kind].fields) {
    const name = `v.${id}`;
    if (field.type === "many") {
      const ticked = form.getAll(name).map(String);
      if (ticked.length > 0) values[id] = ticked;
      continue;
    }
    const typed = text(form, name).trim();
    if (typed === "") continue;
    values[id] = field.type === "yesNo" ? typed === "yes" : typed;
  }
  return values;
}

// A point typed or read by the phone: both halves, as numbers.
function pointOf(form: FormData): { readonly lat: number; readonly lon: number } | undefined {
  const lat = Number.parseFloat(text(form, "lat"));
  const lon = Number.parseFloat(text(form, "lon"));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
}

export type CaseActed =
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "link"; readonly link: string; readonly name: string }
  | { readonly kind: "revealed"; readonly recordId: string; readonly personal: Readonly<Record<string, unknown>> }
  | {
      readonly kind: "render";
      readonly status: number;
      readonly envelope: ErrorEnvelope;
      readonly typed: Readonly<Record<string, string>>;
    };

const typedIn = (form: FormData): Record<string, string> =>
  Object.fromEntries([...form].flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : [])));

// A count typed in a box: empty clears it, and what is not a number goes on to be refused by name.
const numberOrText = (typed: string) => (typed === "" ? null : Number.isFinite(Number(typed)) ? Number(typed) : typed);

// What each of the screen's forms posts, by its intent.
function casePost(form: FormData): readonly [path: string, body: unknown] {
  const record = encodeURIComponent(text(form, "recordId"));
  const member = encodeURIComponent(text(form, "memberId"));
  const revision = Number(text(form, "revision"));
  switch (text(form, "intent")) {
    case "record": {
      const kind = CASE_KINDS.find((one) => one === text(form, "kind")) ?? "house";
      return ["records", { kind, values: recordValues(kind, form), point: pointOf(form) }];
    }
    case "update": {
      const kind = CASE_KINDS.find((one) => one === text(form, "kind")) ?? "house";
      return [`records/${record}`, { values: recordValues(kind, form), point: pointOf(form) ?? null, revision }];
    }
    case "cancel":
      return [`records/${record}/cancel`, { reason: text(form, "reason") }];
    case "photo": {
      const upload = new FormData();
      for (const name of ["photo", "face", "lat", "lon", "accuracy", "readAt"]) {
        const value = form.get(name);
        if (value !== null && value !== "") upload.set(name, value);
      }
      return [`records/${record}/media`, upload];
    }
    case "nil":
      return ["nil", { metric: text(form, "metric"), nil: text(form, "nil") === "1", revision }];
    case "member":
      return ["members", { name: text(form, "name"), number: text(form, "number") }];
    case "removeMember":
      return [`members/${member}/remove`, {}];
    case "renewLink":
      return [`members/${member}/link`, {}];
    case "reveal":
      return [`records/${record}/reveal`, {}];
    default:
      return [
        "fields",
        {
          revision,
          fields: {
            emergencyStatus: text(form, "emergencyStatus"),
            decreeNumber: text(form, "decreeNumber"),
            decreeDate: text(form, "decreeDate"),
            efforts: text(form, "efforts"),
            personnel: numberOrText(text(form, "personnel")),
            post:
              text(form, "postName") === "" ? null : { name: text(form, "postName"), phone: text(form, "postPhone") },
          },
        },
      ];
  }
}

// POST /lapor/data/<file>: one of the screen's forms. A change kept goes back to the tab it was made
// on; a new member's link and a record shown in full are answered on the page itself.
export async function actOnCase(fileId: string, form: FormData, api: ApiCall): Promise<CaseActed> {
  const file = encodeURIComponent(fileId);
  const [path, body] = casePost(form);
  const response = await api("POST", `/cases/${file}/${path}`, body);
  if (!response.ok) {
    const envelope = (await response.json()) as ErrorEnvelope;
    return { kind: "render", status: response.status, envelope, typed: typedIn(form) };
  }
  const intent = text(form, "intent");
  if (intent === "member" || intent === "renewLink") {
    const { link } = (await response.json()) as { link: string };
    return { kind: "link", link, name: text(form, "name") };
  }
  if (intent === "reveal") {
    const { personal } = (await response.json()) as { personal: Record<string, unknown> };
    return { kind: "revealed", recordId: text(form, "recordId"), personal };
  }
  const kind = text(form, "kind");
  const tab = CASE_KINDS.some((one) => one === kind) ? `?jenis=${kind}&saved=${intent}` : `?saved=${intent}`;
  return { kind: "redirect", location: `/lapor/data/${file}${tab}` };
}

export type LinkActed =
  | { readonly kind: "joined"; readonly location: string; readonly headers: Headers }
  | { readonly kind: "refused"; readonly envelope: ErrorEnvelope };

// POST /lapor/data/masuk/<token>: the link exchanged for the member's own cookie, then the file.
export async function joinCase(token: string, api: ApiCall): Promise<LinkActed> {
  const response = await api("POST", `/case-links/${encodeURIComponent(token)}`);
  if (!response.ok) return { kind: "refused", envelope: (await response.json()) as ErrorEnvelope };
  const { fileId } = (await response.json()) as { fileId: string };
  const headers = new Headers();
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return { kind: "joined", location: `/lapor/data/${encodeURIComponent(fileId)}`, headers };
}

export const caseTexts = texts;
