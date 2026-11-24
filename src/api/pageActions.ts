import type { ErrorEnvelope } from "../contract/errors";
import { checkIdentity, type FieldError } from "../domain/identityForm";
import { readBackNumber } from "../domain/phoneNumber";
import { PRIVACY } from "../domain/privacy";
import type { ApiCall } from "./bridge";
import { fieldErrors } from "./routes/shared";

// The page actions of the start step and the draft page, for forms that work with no script.
// Render-only actions store nothing and log nothing: they redraw the form with what was sent.
type StartAction =
  | "readBack"
  | "decline"
  | "declineBack"
  | "declineConfirm"
  | "consent"
  | "useProfile"
  | "replaceOpenDraft"
  | "removeProfileAsk"
  | "removeProfile";

const IDENTITY_FIELDS = ["role", "name", "number", "officerRegency", "officerPosition"] as const;
type IdentityValues = Readonly<Record<(typeof IDENTITY_FIELDS)[number], string>>;

type StartView = "form" | "readBack" | "declineConfirm" | "declined" | "replaceConfirm" | "removeConfirm";

export type PageResult =
  | { readonly kind: "redirect"; readonly location: string; readonly headers: Headers }
  | {
      readonly kind: "render";
      readonly status: number;
      readonly view: StartView | "draft";
      readonly values: IdentityValues;
      readonly profileId: string | null;
      // "+62 800 0000 0001", shown before anything is stored.
      readonly readBack: string | null;
      readonly envelope: ErrorEnvelope | null;
    };

type Form = FormData;

const field = (form: Form, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

function valuesOf(form: Form): IdentityValues {
  return Object.fromEntries(IDENTITY_FIELDS.map((name) => [name, field(form, name)])) as IdentityValues;
}

const invalid = (errors: readonly FieldError[]): ErrorEnvelope => ({
  error: { code: "request.invalidFields", copyKey: "error.request.invalidFields", params: {} },
  fields: fieldErrors(errors),
  retryAt: null,
  draft: null,
});

function render(
  view: StartView | "draft",
  form: Form,
  status = 200,
  envelope: ErrorEnvelope | null = null,
  readBack: string | null = null,
): PageResult {
  const profileId = field(form, "profileId");
  return {
    kind: "render",
    status,
    view,
    values: valuesOf(form),
    profileId: profileId === "" ? null : profileId,
    readBack,
    envelope,
  };
}

// After a write the browser goes to the address the write leads to; a new device cookie goes with it.
function redirect(location: string, response: Response): PageResult {
  const headers = new Headers({ location });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return { kind: "redirect", location, headers };
}

async function created(response: Response, form: Form, refusedView: StartView): Promise<PageResult> {
  if (response.status === 201)
    return redirect(`/lapor/report/${((await response.json()) as { draftId: string }).draftId}`, response);
  const envelope = (await response.json()) as ErrorEnvelope;
  return render(response.status === 409 ? "replaceConfirm" : refusedView, form, response.status, envelope);
}

function identityBody(values: IdentityValues, withNumber: boolean) {
  return {
    role: values.role,
    name: values.name,
    ...(withNumber ? { number: values.number } : {}),
    officerRegency: values.officerRegency,
    officerPosition: values.officerPosition,
  };
}

// POST /lapor/report. The session path has no number box, so a form without one consents without it.
export async function startStepAction(form: Form, api: ApiCall): Promise<PageResult> {
  const action = field(form, "action") as StartAction;
  const values = valuesOf(form);
  const withNumber = form.get("number") !== null;
  switch (action) {
    case "readBack": {
      const checked = checkIdentity({ ...values, number: withNumber ? values.number : null });
      if ("errors" in checked) return render("form", form, 422, invalid(checked.errors));
      return render(
        "readBack",
        form,
        200,
        null,
        checked.identity.number === null ? null : readBackNumber(checked.identity.number),
      );
    }
    case "decline":
      return render("declineConfirm", form);
    case "declineBack":
      return render("form", form);
    case "declineConfirm":
      // The decline is final: nothing typed is drawn again.
      return render("declined", new FormData());
    case "consent": {
      const response = await api("POST", "/consent", {
        ...identityBody(values, withNumber),
        privacyVersion: PRIVACY.version,
        agree: true,
      });
      return created(response, form, "form");
    }
    case "useProfile":
    case "replaceOpenDraft": {
      const editing = field(form, "editProfile") === "1";
      const body = {
        profileId: field(form, "profileId"),
        replaceOpenDraft: action === "replaceOpenDraft",
        ...(editing ? { profileEdit: identityBody(values, false) } : {}),
      };
      return created(await api("POST", "/drafts", body), form, "form");
    }
    case "removeProfileAsk":
      return render("removeConfirm", form);
    case "removeProfile": {
      if (field(form, "confirm") !== "yes") return render("removeConfirm", form);
      const response = await api("DELETE", `/me/profiles/${encodeURIComponent(field(form, "profileId"))}`, {
        confirm: true,
      });
      if (response.status === 204) return redirect("/lapor/report", response);
      return render("form", form, response.status, (await response.json()) as ErrorEnvelope);
    }
    default:
      return render("form", form, 400);
  }
}

// POST /lapor/report/<draftId>: a turn or a send from a form. Box values travel as "value.<fieldId>".
// The photo route's form: the file and the turn controls, and the device reading the page put in
// its boxes (value.<name>, as every box of a turn form travels).
const READING_FIELDS = ["lat", "lon", "accuracy", "readAt", "offset"] as const;

function photoForm(form: Form): FormData {
  const photo = new FormData();
  for (const name of ["photo", "revision", "turnKey"]) {
    const value = form.get(name);
    if (value !== null) photo.set(name, value);
  }
  for (const name of READING_FIELDS) photo.set(name, field(form, `value.${name}`));
  return photo;
}

export async function draftPageAction(draftId: string, form: Form, api: ApiCall): Promise<PageResult> {
  const path = `/drafts/${encodeURIComponent(draftId)}`;
  const revision = Number(field(form, "revision"));
  const turnKey = field(form, "turnKey");
  const action = field(form, "action");
  const response =
    action === "photo"
      ? await api("POST", `${path}/photos`, photoForm(form))
      : action === "rate"
        ? await api("POST", `/reports/${encodeURIComponent(field(form, "value.ticketNumber"))}/rating`, {
            rating: Number(field(form, "value.rating")),
          })
        : action === "send"
          ? await api("POST", `${path}/send`, { revision, turnKey })
          : await api("POST", `${path}/turns`, {
              revision,
              turnKey,
              kind: field(form, "kind") || "answer",
              cardId: field(form, "cardId") || null,
              optionIds: form.getAll("optionIds").map(String),
              values: Object.fromEntries(
                [...form.keys()]
                  .filter((name) => name.startsWith("value."))
                  .map((name) => [name.slice(6), field(form, name)]),
              ),
              text: field(form, "text"),
              groupId: field(form, "groupId") || null,
              villageCode: field(form, "villageCode") || null,
            });
  if (response.ok) return redirect(`/lapor/report/${draftId}`, response);
  return render("draft", form, response.status, (await response.json()) as ErrorEnvelope);
}
