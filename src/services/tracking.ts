import { closedProofKey, handlingOf } from "../adapters/d1/handling";
import {
  ownReports,
  type ReportRecord,
  rateReport,
  referenceFile,
  reportByTicket,
  reportByTrackingHash,
} from "../adapters/d1/reports";
import type { Tracking } from "../contract/tracking";
import { checkContactFile, pickContact } from "../domain/contacts";
import type { EventTimeValue, PlaceValue } from "../domain/fieldState";
import type { FieldError } from "../domain/identityForm";
import { ownsDraft, SESSION_SLOT } from "../domain/ownership";
import { rejectionOf, stagesOf } from "../domain/stages";
import { run, sqlState } from "../platform/database";
import { hmacKey, sha256Hex } from "../platform/keys";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { at, draftZone } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";

// The tracking link's secret: made from the report id by HMAC, so it can be given again at any
// time and only its hash is stored. 32 hex characters, as upstream's.
export async function trackingToken(secret: string, reportId: string): Promise<string> {
  return (await hmacKey(secret, "tracking", reportId)).slice(0, 32);
}

const TOKEN = /^[0-9a-f]{32}$/;

// The BPBD to call. A contact file that cannot be read shows BNPB's 117; the report is unaffected.
export async function contactOf(
  bindings: ServiceBindings,
  place: Pick<PlaceValue, "villageCode" | "regencyName" | "provinceName">,
): Promise<Tracking["contact"]> {
  let file = null;
  try {
    file = checkContactFile(await referenceFile(bindings.db, "bpbdContacts"));
  } catch (error) {
    const state = sqlState(error);
    bindings.log.error({
      event: "contacts.failed",
      errorCode: "contacts.unavailable",
      ...(state ? { sqlState: state } : {}),
    });
  }
  const picked = pickContact(file, place.villageCode);
  if (picked.level === "national") return { level: "national" };
  const name = picked.level === "regency" ? place.regencyName : place.provinceName;
  return { level: picked.level, name, phone: picked.phone };
}

const fieldValue = <T>(report: ReportRecord, field: string): T | null => {
  const state = report.states[field];
  return state?.state === "value" ? (state.value as T) : null;
};

export async function trackingOf(bindings: ServiceBindings, report: ReportRecord): Promise<Tracking> {
  const zone = draftZone(report.villageCode);
  const place = fieldValue<PlaceValue>(report, "place") as PlaceValue;
  const rejection = rejectionOf(report.history);
  const handling = await handlingOf(bindings.db, report.ticketNumber);
  const closed = report.history.at(-1)?.toStatus === "closed";
  return {
    ticketNumber: report.ticketNumber,
    sentAt: at(report.sentAt, zone),
    actions: handling.actions.map((action) => action.label),
    proofs: closed ? handling.proofs.map((proof) => ({ proofId: proof.id, at: at(proof.atMs, zone) })) : [],
    rejected: rejection === null ? null : { at: at(rejection.atMs, zone), reason: rejection.note as string },
    stages: stagesOf(report.history).map((stage) => ({
      status: stage.status,
      reachedAt: stage.reachedAtMs === null ? null : at(stage.reachedAtMs, zone),
    })),
    hazardType: report.hazardType as Tracking["hazardType"],
    hazardSubtype: fieldValue<string>(report, "hazardSubtype"),
    place: { villageName: place.villageName, districtName: place.districtName, regencyName: place.regencyName },
    eventTime: fieldValue<EventTimeValue>(report, "eventTime"),
    photoCount: report.photoCount,
    contact: await contactOf(bindings, place),
  };
}

export type TrackAnswer =
  | { readonly kind: "ok"; readonly tracking: Tracking }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A tracking link opened anywhere, signed in or not. An unknown token and a malformed one are
// told the same, so a guess learns nothing.
export async function trackReport(bindings: ServiceBindings, address: string, token: string): Promise<TrackAnswer> {
  const refusal = await checkLimits(bindings, [["address.tracking", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  if (!TOKEN.test(token)) return { kind: "notFound" };
  const report = await reportByTrackingHash(bindings.db, await sha256Hex(token));
  return report ? { kind: "ok", tracking: await trackingOf(bindings, report) } : { kind: "notFound" };
}

export type ProofAnswer =
  | { readonly kind: "file"; readonly bytes: Uint8Array }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A photo of the work, for the holder of a closed report's own link.
export async function trackedProof(
  bindings: ServiceBindings,
  address: string,
  token: string,
  proofId: string,
): Promise<ProofAnswer> {
  const refusal = await checkLimits(bindings, [["address.tracking", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const report = TOKEN.test(token) ? await reportByTrackingHash(bindings.db, await sha256Hex(token)) : null;
  const key = report === null ? null : await closedProofKey(bindings.db, report.ticketNumber, proofId);
  const bytes = key === null ? null : await bindings.photos.get(key);
  return bytes === null ? { kind: "notFound" } : { kind: "file", bytes };
}

// The same photo on the reporter's own page, where the phone or session is the key.
export async function ownProof(
  bindings: ServiceBindings,
  principal: Principal,
  ticketNumber: string,
  proofId: string,
): Promise<Uint8Array | null> {
  const report = await ownedReport(bindings, principal, ticketNumber);
  const key = report === null ? null : await closedProofKey(bindings.db, ticketNumber, proofId);
  return key === null ? null : bindings.photos.get(key);
}

export type RateAnswer =
  | { readonly kind: "ok" }
  | { readonly kind: "notFound" }
  | { readonly kind: "invalid"; readonly errors: readonly FieldError[] }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A sent report, to the phone or session that sent it; null to anyone else.
export async function ownedReport(
  bindings: ServiceBindings,
  principal: Principal,
  ticketNumber: string,
): Promise<ReportRecord | null> {
  const report = await reportByTicket(bindings.db, ticketNumber);
  if (report === null || report.reporterId === null) return null;
  return ownsDraft(principal, { reporterId: report.reporterId, ownerSlot: report.ownerSlot }) ? report : null;
}

// The reporter's 1 to 5 rating of one report (K81), by its owner only; a new one replaces the old.
export async function rateOwnReport(
  bindings: ServiceBindings,
  principal: Principal,
  ticketNumber: string,
  rating: number,
): Promise<RateAnswer> {
  const report = await ownedReport(bindings, principal, ticketNumber);
  if (report === null) return { kind: "notFound" };
  const refusal = await checkLimits(bindings, [
    ["rating.hour", { kind: "numberSlot", numberKey: report.numberKey, ownerSlot: report.ownerSlot }],
  ]);
  if (refusal) return { kind: "limit", refusal };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return { kind: "invalid", errors: [{ fieldId: "rating", rule: "rating.range", params: {} }] };
  await run(bindings.db, rateReport(report.id, rating, new Date(bindings.clock.now())));
  return { kind: "ok" };
}

function ownerOf(principal: Principal) {
  if (principal.kind === "device") return { ownerSlot: principal.deviceId };
  if (principal.kind === "session") return { reporterId: principal.reporterId };
  if (principal.kind !== "chat" || principal.reporterId === null) return null;
  return { reporterId: principal.reporterId, ownerSlot: SESSION_SLOT };
}

// "Laporan saya": the reports of this number made on this device, of the session's number, or of
// the chat's, newest first, each with its tracking secret.
export async function myReports(bindings: ServiceBindings, principal: Principal) {
  const owner = ownerOf(principal);
  const found = owner === null ? [] : await ownReports(bindings.db, owner);
  return Promise.all(
    found.map(async (report) => ({
      ticketNumber: report.ticketNumber,
      hazardType: report.hazardType as Tracking["hazardType"],
      sentAt: at(report.sentAt, draftZone(report.villageCode)),
      status: report.status,
      unread: report.unread,
      trackingToken: await trackingToken(bindings.settings.keyHmacSecret, report.id),
    })),
  );
}
