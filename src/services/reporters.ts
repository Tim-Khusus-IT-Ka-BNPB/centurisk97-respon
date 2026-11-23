import { addMessages, DRAFT_LIFE_MS, endDraft, isLive, type OpenDraft, openDraftOf } from "../adapters/d1/drafts";
import {
  addConsent,
  createDevice,
  createDraft,
  deleteProfile,
  deleteUnusedReporters,
  knownProfiles,
  profileById,
  profileBySlot,
  profileCount,
  profileOf,
  reporterIdOf,
  saveProfile,
  updateProfile,
  upsertReporter,
} from "../adapters/d1/reporters";
import type { MeResponse } from "../contract/draft";
import type { Identity } from "../domain/identityForm";
import { LIMITS } from "../domain/limits";
import { ownerSlotOf } from "../domain/ownership";
import { maskNumber } from "../domain/phoneNumber";
import { PRIVACY } from "../domain/privacy";
import { atomically, decide, holds, type Query, row, sql } from "../platform/database";
import { hmacKey, sha256Hex } from "../platform/keys";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { draftZone, LIFE_LINE, at as shownAt } from "./draftView";

const DEVICE_KEY_BYTES = 32;

function newDeviceKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(DEVICE_KEY_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// The first lines of every new draft: the greeting and the place question.
const openingMessages = (draftId: string, at: Date): Query[] =>
  addMessages(
    draftId,
    [
      { speaker: "assistant", copyKey: "chat.greeting", params: {}, cardKind: null },
      { speaker: "assistant", copyKey: "card.placeSearch.title", params: {}, cardKind: "placeSearch" },
    ],
    at,
  );

// A new draft, with the open one ended first when it is past its 24 hours. The one-open-draft
// index refuses a second open draft, so a race between two of these ends in one draft.
function newDraft(numberKey: string, profileIdOf: Query, slot: string, open: OpenDraft | null, at: Date) {
  const draftId = crypto.randomUUID();
  const expired = open === null ? [] : endDraft(open.id, "expired", at, sql`last_acted_at = ${open.lastActedAt}`);
  return {
    draftId,
    writes: [
      ...expired,
      createDraft(draftId, numberKey, profileIdOf, slot, at, [LIFE_LINE]),
      ...openingMessages(draftId, at),
    ],
  };
}

const STILL_OPEN = (draftId: string) =>
  holds(
    sql`exists (select 1 from report_draft where id = ${draftId} and state not in ('sent', 'cancelled', 'expired'))`,
  );

export type ConsentResult =
  | { readonly kind: "draft"; readonly draftId: string; readonly deviceKey: string | null }
  | { readonly kind: "deviceFull" };

// "Setuju" and "Ya": number, binding, profile, consent and the first draft are written together.
// Nothing exists before this. A repeated post returns the draft already open.
export async function giveConsent(
  bindings: ServiceBindings,
  principal: Principal,
  identity: Identity,
): Promise<ConsentResult> {
  const at = new Date(bindings.clock.now());
  const deviceKey = principal.kind === "anonymous" ? newDeviceKey() : null;
  const fingerprint = deviceKey === null ? null : await sha256Hex(deviceKey);
  const numberKey =
    identity.number === null ? null : await hmacKey(bindings.settings.keyHmacSecret, "number", identity.number);
  return decide(async (): Promise<ConsentResult | null> => {
    const db = bindings.db;
    let key: string;
    let deviceId: string | null = null;
    const writes: Query[] = [];
    if (principal.kind === "session") {
      const known = await row<{ number_key: string }>(
        db,
        sql`select number_key from reporter where id = ${principal.reporterId}`,
      );
      key = (known as { number_key: string }).number_key;
    } else {
      key = numberKey as string;
      if (principal.kind === "device") deviceId = principal.deviceId;
      else {
        deviceId = crypto.randomUUID();
        writes.push(createDevice(deviceId, fingerprint as string, at));
      }
      writes.push(upsertReporter(crypto.randomUUID(), identity.number as string, key, at));
    }
    const slot = deviceId ?? "session";
    const reporterId = principal.kind === "session" ? principal.reporterId : await reporterIdOf(db, key);
    const existing = reporterId === null ? null : await profileBySlot(db, reporterId, slot);
    const max = LIMITS["device.numbers"].max;
    if (!existing && principal.kind === "device") {
      const counted = await row<{ count: number }>(db, sql`select ${profileCount(principal.deviceId)} as count`);
      if ((counted as { count: number }).count >= max) return { kind: "deviceFull" };
    }
    const profileIdOf = profileOf(key, slot);
    writes.push(saveProfile(crypto.randomUUID(), key, slot, deviceId, identity, at));
    // A second number on the same device in the same moment cannot pass the cap either.
    if (deviceId !== null) writes.push(holds(sql`${profileCount(deviceId)} <= ${max}`));
    writes.push(addConsent(crypto.randomUUID(), profileIdOf, PRIVACY.version, at));
    const open = reporterId === null ? null : await openDraftOf(db, reporterId, slot);
    if (open && isLive(open, at)) {
      const kept = await atomically(db, [...writes, STILL_OPEN(open.id)]);
      return kept === null ? null : { kind: "draft", draftId: open.id, deviceKey };
    }
    const created = newDraft(key, profileIdOf, slot, open, at);
    const done = await atomically(db, [...writes, ...created.writes]);
    return done === null ? null : { kind: "draft", draftId: created.draftId, deviceKey };
  });
}

export type StartResult =
  | { readonly kind: "draft"; readonly draftId: string }
  | { readonly kind: "openExists"; readonly draftId: string }
  | { readonly kind: "notFound" };

// A known reporter starts a draft with one tap. An open draft is replaced only after its confirm.
export async function startDraft(
  bindings: ServiceBindings,
  principal: Principal,
  profileId: string,
  replaceOpenDraft: boolean,
  edit: Omit<Identity, "number"> | null,
): Promise<StartResult> {
  const at = new Date(bindings.clock.now());
  const slot = ownerSlotOf(principal);
  return decide(async (): Promise<StartResult | null> => {
    const profile = await profileById(bindings.db, profileId);
    if (!profile || profile.owner_slot !== slot) return { kind: "notFound" };
    if (principal.kind === "session" && profile.reporter_id !== principal.reporterId) return { kind: "notFound" };
    const open = await openDraftOf(bindings.db, profile.reporter_id, profile.owner_slot);
    const live = open !== null && isLive(open, at);
    if (open !== null && live && !replaceOpenDraft) return { kind: "openExists", draftId: open.id };
    const replaced = open !== null && live ? endDraft(open.id, "cancelled", at) : [];
    const created = newDraft(profile.number_key, sql`${profile.id}`, profile.owner_slot, live ? null : open, at);
    const done = await atomically(bindings.db, [
      ...replaced,
      updateProfile(profile.id, edit, at),
      holds(sql`changes() = 1`),
      ...created.writes,
    ]);
    return done === null ? null : { kind: "draft", draftId: created.draftId };
  });
}

// "Hapus dari perangkat ini": the binding goes, its open draft is cancelled, and the number row
// goes when nothing else uses it. Sent versions keep their own copy.
export async function removeProfile(
  bindings: ServiceBindings,
  principal: Principal,
  profileId: string,
): Promise<boolean> {
  if (principal.kind !== "device") return false;
  const at = new Date(bindings.clock.now());
  return decide(async (): Promise<boolean | null> => {
    const profile = await profileById(bindings.db, profileId);
    if (!profile || profile.device_id !== principal.deviceId) return false;
    const open = await openDraftOf(bindings.db, profile.reporter_id, profile.owner_slot);
    const done = await atomically(bindings.db, [
      ...(open === null ? [] : endDraft(open.id, "removedNumber", at)),
      deleteProfile(profile.id),
      holds(sql`changes() = 1`),
      deleteUnusedReporters(sql`(${profile.reporter_id})`),
    ]);
    return done === null ? null : true;
  });
}

// GET /me: the numbers known on this device or in this session, each with its open draft.
export async function knownReporters(bindings: ServiceBindings, principal: Principal): Promise<MeResponse> {
  const nowMs = bindings.clock.now();
  const where =
    principal.kind === "device"
      ? { deviceId: principal.deviceId }
      : principal.kind === "session"
        ? { reporterId: principal.reporterId }
        : null;
  const rows = where === null ? [] : await knownProfiles(bindings.db, where, new Date(nowMs - DRAFT_LIFE_MS));
  return {
    knownReporters: rows.map((row) => ({
      profileId: row.id,
      name: row.name,
      maskedNumber: maskNumber(row.number),
      role: row.role,
      lastUsedAt: shownAt(row.last_used_at, "WIB"),
      openDraft:
        row.draft_id === null
          ? null
          : {
              draftId: row.draft_id,
              hazardType: row.draft_hazard_type,
              lastActedAt: shownAt(row.draft_last_acted_at as Date, draftZone(row.draft_village_code)),
            },
    })),
    privacyVersion: PRIVACY.version,
    session:
      principal.kind === "session" ? { kind: "reporter" } : principal.kind === "staff" ? { kind: "staff" } : null,
  };
}
