import type { ApiCall } from "../../src/api/bridge";
import { startStepAction } from "../../src/api/pageActions";
import type { DraftBody, MeResponse } from "../../src/contract/draft";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { StartActionData, StartPageData, StartView } from "./startTypes";
import { PAGE_TEXTS, pickTexts } from "./texts.server";

async function readMe(api: ApiCall): Promise<MeResponse | null> {
  const response = await api("GET", "/me");
  return response.ok ? ((await response.json()) as MeResponse) : null;
}

// GET /lapor/report: the numbers known here, a picked one, "Ganti" on one, or the form.
export async function loadStartPage(url: URL, api: ApiCall): Promise<StartPageData> {
  const me = await readMe(api);
  const known = me?.knownReporters ?? [];
  const has = (id: string | null) => id !== null && known.some((profile) => profile.profileId === id);
  const picked = url.searchParams.get("profile");
  const discarded = url.searchParams.get("discard");
  const edited = url.searchParams.get("edit");
  let view: StartView = known.length > 0 && !url.searchParams.has("new") ? "list" : "form";
  let profileId: string | null = null;
  if (has(discarded)) {
    view = "discardConfirm";
    profileId = discarded;
  } else if (has(edited)) {
    view = "form";
    profileId = edited;
  } else if (has(picked)) {
    view = "confirm";
    profileId = picked;
  }
  return {
    me,
    view,
    profileId,
    editing: view === "form" && profileId !== null,
    emergency: isEmergency(url),
    texts: pickTexts(PAGE_TEXTS.start),
  };
}

// "Lapor darurat" opens the start page with this, and every step of it keeps it.
export const isEmergency = (url: URL) => url.searchParams.has("darurat");

// A poster's code opens the start page with its village's ten digits (D131), as "11.08.01.2001".
export function posterVillageCode(url: URL): string | null {
  const digits = /^(\d{2})(\d{2})(\d{2})(\d{4})$/.exec(url.searchParams.get("desa") ?? "");
  return digits ? digits.slice(1).join(".") : null;
}

export type StartActed =
  | { readonly kind: "redirect"; readonly location: string; readonly headers: Headers }
  | { readonly kind: "render"; readonly status: number; readonly data: StartActionData };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

// POST /lapor/report. A redirect carries the new device cookie on to the browser.
export async function actOnStart(
  form: FormData,
  api: ApiCall,
  emergency = false,
  villageCode: string | null = null,
): Promise<StartActed> {
  const action = text(form, "action");
  const masked = text(form, "maskedNumber");
  if (action === "discardOpenDraft") return discardOpenDraft(text(form, "draftId"), form, api);
  // "Ganti" on the read-back is the way back to the form, with focus on the number.
  if (action === "changeNumber") form.set("action", "declineBack");
  const result = await startStepAction(form, api, emergency, villageCode);
  if (result.kind === "redirect" && action === "removeProfile")
    return { kind: "render", status: 200, data: rendered("list", form, null, { removed: masked }) };
  if (result.kind === "redirect") return result;
  const removeFailed = action === "removeProfile" && result.envelope !== null ? masked : null;
  return {
    kind: "render",
    status: result.status,
    data: {
      ...rendered(removeFailed ? "list" : (result.view as StartView), form, result.envelope, { removeFailed }),
      values: result.values,
      readBack: result.readBack,
      focusNumber: action === "changeNumber",
    },
  };
}

function rendered(
  view: StartView,
  form: FormData,
  envelope: StartActionData["envelope"],
  notes: Partial<Pick<StartActionData, "removed" | "removeFailed">>,
): StartActionData {
  const profileId = text(form, "profileId");
  return {
    view,
    values: { role: "", name: "", number: "", officerRegency: "", officerPosition: "" },
    profileId: profileId === "" ? null : profileId,
    editing: text(form, "editProfile") === "1",
    readBack: null,
    envelope,
    removed: notes.removed ?? null,
    removeFailed: notes.removeFailed ?? null,
    focusNumber: false,
  };
}

const turn = (api: ApiCall, draftId: string, revision: number, kind: "cancel" | "confirm") =>
  api("POST", `/drafts/${encodeURIComponent(draftId)}/turns`, { revision, turnKey: crypto.randomUUID(), kind });

// A new report from the home's resume offer: nobody has said who reports yet, so the open draft
// is cancelled (its content removed, as "Batal" does) and the reporter goes to the identity choice.
async function discardOpenDraft(draftId: string, form: FormData, api: ApiCall): Promise<StartActed> {
  let response = await api("GET", `/drafts/${encodeURIComponent(draftId)}`);
  for (const kind of ["cancel", "confirm"] as const) {
    if (!response.ok) break;
    const { revision } = (await response.json()) as DraftBody;
    response = await turn(api, draftId, revision, kind);
  }
  if (response.ok)
    return { kind: "redirect", location: "/lapor/report", headers: new Headers({ location: "/lapor/report" }) };
  const envelope = (await response.json()) as ErrorEnvelope;
  return { kind: "render", status: response.status, data: rendered("list", form, envelope, {}) };
}
