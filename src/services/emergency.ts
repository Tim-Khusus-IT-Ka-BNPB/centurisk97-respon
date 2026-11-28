import { lastOneTap, offlineTicket, oneTapsOfDay, openEmergencies, sendOneTap } from "../adapters/postgres/emergency";
import { draftPhotos, insertPhoto } from "../adapters/postgres/photos";
import { knownProfiles, latestConsent, type ProfileRow } from "../adapters/postgres/reporters";
import { ownReports, reportByTicket } from "../adapters/postgres/reports";
import { ticketNumberOf } from "../adapters/postgres/send";
import type { DeskEmergency } from "../contract/desk";
import type { OneTapSent, OneTapStart } from "../contract/emergency";
import { emergencyStates, oneTapDayOpensAt, oneTapOpensAt, type VictimAnswer } from "../domain/emergency";
import { zoneOffsetMs } from "../domain/eventTime";
import type { FieldStates, PlacePoint, PlaceValue } from "../domain/fieldState";
import { completePercent } from "../domain/fields/applicable";
import type { HazardTypeId } from "../domain/hazards";
import { readExif, stripJpeg } from "../domain/jpeg";
import { OFFLINE_PHOTOS, offlineMark, offlinePhotoClock } from "../domain/offline";
import { maskNumber } from "../domain/phoneNumber";
import { checkPhoto, type DeviceFix } from "../domain/photoChecks";
import { formatTicketNumber, ticketDay } from "../domain/ticketNumber";
import { MINUTE_MS } from "../domain/time";
import { triage } from "../domain/triage";
import { EMPTY_CONTENT } from "../domain/turn/content";
import { run } from "../platform/database";
import { sha256Hex } from "../platform/keys";
import type { Principal, StaffPrincipal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { at, draftZone } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";
import { locatePlace } from "./places";
import { contactOf, trackingOf, trackingToken } from "./tracking";

export type Reporter = Extract<Principal, { kind: "device" | "session" }>;

// The reporter last used on this phone or in this session. One tap reports under a reporter who
// has agreed before; nobody else is known here, and nothing is kept of them.
async function reporterOf(bindings: ServiceBindings, principal: Reporter): Promise<ProfileRow | null> {
  const where = principal.kind === "device" ? { deviceId: principal.deviceId } : { reporterId: principal.reporterId };
  return (await knownProfiles(bindings.db, where, new Date(bindings.clock.now())))[0] ?? null;
}

export async function oneTapStart(bindings: ServiceBindings, principal: Reporter): Promise<OneTapStart | null> {
  const profile = await reporterOf(bindings, principal);
  if (profile === null) return null;
  const [latest] = await ownReports(bindings.db, { ownerSlot: profile.owner_slot });
  const report = latest === undefined ? null : await reportByTicket(bindings.db, latest.ticketNumber);
  return {
    name: profile.name,
    maskedNumber: maskNumber(profile.number),
    contact: report === null ? { level: "national" } : (await trackingOf(bindings, report)).contact,
  };
}

export type OneTapAnswer =
  | ({ readonly kind: "sent" } & OneTapSent)
  | { readonly kind: "unknownReporter" }
  | { readonly kind: "place"; readonly rule: "outside" | "notFound" | "unavailable" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// "Darurat sekali ketuk" (K90, D123, D124): the phone's point goes to the desk as an emergency.
// What a report made with no signal adds to the point: its kind, whether anyone is hurt, when it was
// made, and the id it was given on the phone (LR-03 to LR-05).
export type OfflineDetails = {
  readonly hazardType?: HazardTypeId;
  readonly victims?: VictimAnswer;
  // When the phone saved it and when the phone sent it, by the phone's clock: present only for a
  // report kept there with no signal.
  readonly takenAtMs?: number;
  readonly sentAtMs?: number;
  readonly clientId?: string;
};

async function sentBefore(bindings: ServiceBindings, clientId: string): Promise<OneTapAnswer | null> {
  const before = await offlineTicket(bindings.db, clientId);
  if (before === null) return null;
  const report = (await reportByTicket(bindings.db, before.ticketNumber)) as NonNullable<
    Awaited<ReturnType<typeof reportByTicket>>
  >;
  const place = (report.states.place as { readonly value: PlaceValue }).value;
  return {
    kind: "sent",
    ticketNumber: before.ticketNumber,
    trackingToken: await trackingToken(bindings.settings.keyHmacSecret, before.reportId),
    contact: await contactOf(bindings, place),
  };
}

export async function oneTapEmergency(
  bindings: ServiceBindings,
  principal: Reporter,
  address: string,
  reading: PlacePoint & OfflineDetails,
): Promise<OneTapAnswer> {
  const db = bindings.db;
  const profile = await reporterOf(bindings, principal);
  const consent = profile === null ? null : await latestConsent(db, profile.id);
  if (profile === null || consent === null) return { kind: "unknownReporter" };
  if (reading.clientId) {
    const replayed = await sentBefore(bindings, reading.clientId);
    if (replayed) return replayed;
  }
  const nowMs = bindings.clock.now();
  // The phone's clock is a note only: the event is placed at the time it reached the desk (LR-09).
  const mark = reading.takenAtMs === undefined ? null : offlineMark(reading.takenAtMs, reading.sentAtMs, nowMs);
  const deviceOpens = async () => oneTapOpensAt(await lastOneTap(db, profile.number_key, profile.owner_slot), nowMs);
  const tooSoon = await deviceOpens();
  if (tooSoon !== null) return { kind: "limit", refusal: { limitId: "oneTap.device", retryAtMs: tooSoon } };
  const tooMany = oneTapDayOpensAt(await oneTapsOfDay(db, profile.number_key, nowMs), nowMs);
  if (tooMany !== null) return { kind: "limit", refusal: { limitId: "oneTap.number", retryAtMs: tooMany } };
  const refusal = await checkLimits(bindings, [["address.oneTap", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const located = await locatePlace(bindings, reading);
  if (located.kind !== "found") return { kind: "place", rule: located.kind };
  const place = located.reading.village;
  const states: FieldStates = emergencyStates(
    {
      place: { state: "value", value: place, origin: "system" },
      hazardType: reading.hazardType
        ? { state: "value", value: reading.hazardType, origin: "tappedOption" }
        : { state: "notYetKnown" },
    },
    nowMs,
    draftZone(place.villageCode),
  );
  const day = ticketDay(nowMs);
  const reportId = crypto.randomUUID();
  const token = await trackingToken(bindings.settings.keyHmacSecret, reportId);
  const ticketNumber = await sendOneTap(
    db,
    {
      reportId,
      trackingHash: await sha256Hex(token),
      ticketNumber: ticketNumberOf(formatTicketNumber(day, 1).slice(0, -3), day),
      draftId: crypto.randomUUID(),
      reporterId: profile.reporter_id,
      numberKey: profile.number_key,
      ownerSlot: profile.owner_slot,
      numberUnverified: principal.kind !== "session",
      // With no kind told, "other", which is never offered, stands for that alone.
      hazardType: reading.hazardType ?? "other",
      villageCode: place.villageCode,
      sentAt: new Date(nowMs),
      content: { ...EMPTY_CONTENT, states },
      reporter: {
        name: profile.name,
        number: profile.number,
        role: profile.role,
        officerRegency: profile.officer_regency,
        officerPosition: profile.officer_position,
      },
      consent,
      completePercent: completePercent(states),
      emergency: { kind: "oneTap", victims: reading.victims ?? "unknown" },
      // A one-tap emergency goes to its BPBD at once, read from the phone's own position.
      triage: triage({
        lifeAtRisk: true,
        place: "gps",
        livePhotos: 0,
        otherReporters: 0,
        history: "none",
        completePercent: completePercent(states),
        model: null,
      }),
    },
    profile.id,
    day,
    reading.clientId ? { clientId: reading.clientId, mark } : null,
  );
  if (ticketNumber === null)
    return { kind: "limit", refusal: { limitId: "oneTap.device", retryAtMs: await deviceOpens() } };
  return { kind: "sent", ticketNumber, trackingToken: token, contact: await contactOf(bindings, place) };
}

export type OfflinePhoto = {
  // Which of the report's kept photos this is, from 0, so a send repeated after a lost answer
  // keeps it once.
  readonly index: number;
  readonly bytes: Uint8Array;
  readonly device: DeviceFix | null;
  readonly offsetMinutes: number | null;
};

export type OfflinePhotoAnswer =
  | { readonly kind: "kept"; readonly photos: number }
  | { readonly kind: "notFound" }
  | { readonly kind: "refused"; readonly rule: string }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// The id of a kept photo, the same each time the phone sends it.
async function keptPhotoId(clientId: string, index: number): Promise<string> {
  const hex = (await sha256Hex(`${clientId}:${index}`)).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A photo kept with a report made with no signal, sent after the report (LR-06). Only the phone or
// session that sent the report adds to it. The photo is checked against when the phone saved the
// report, not when it arrived; a refused photo leaves the report as it is.
export async function addOfflinePhoto(
  bindings: ServiceBindings,
  principal: Reporter,
  address: string,
  clientId: string,
  photo: OfflinePhoto,
): Promise<OfflinePhotoAnswer> {
  const [profile, ticket] = await Promise.all([reporterOf(bindings, principal), offlineTicket(bindings.db, clientId)]);
  if (profile === null || ticket === null || ticket.ownerSlot !== profile.owner_slot) return { kind: "notFound" };
  const refusal = await checkLimits(bindings, [["address.messages", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const id = await keptPhotoId(clientId, photo.index);
  const kept = await draftPhotos(bindings.db, ticket.draftId);
  if (kept.some((one) => one.id === id)) return { kind: "kept", photos: kept.length };
  if (photo.index >= OFFLINE_PHOTOS || kept.length >= OFFLINE_PHOTOS) return { kind: "refused", rule: "tooMany" };
  const report = (await reportByTicket(bindings.db, ticket.ticketNumber)) as NonNullable<
    Awaited<ReturnType<typeof reportByTicket>>
  >;
  const place = (report.states.place as { readonly value: PlaceValue }).value;
  const nowMs = bindings.clock.now();
  const checked = checkPhoto({
    bytes: photo.bytes,
    nowMs: offlinePhotoClock(ticket.savedAt, nowMs),
    // One tap places a report at the phone's own point.
    placePoint: place.point as PlacePoint,
    count: kept.length,
    exif: readExif(photo.bytes),
    device: photo.device,
    fallbackOffsetMinutes: photo.offsetMinutes ?? zoneOffsetMs(draftZone(ticket.villageCode)) / MINUTE_MS,
  });
  if (checked.kind === "refused") return checked;
  const clean = stripJpeg(photo.bytes);
  if (clean === null) return { kind: "refused", rule: "broken" };
  const storeKey = `photos/${ticket.draftId}/${id}.jpg`;
  await bindings.photos.put(storeKey, clean);
  await run(
    bindings.db,
    insertPhoto(ticket.draftId, { ...checked, id, storeKey, bytes: clean.length, doubts: [] }, new Date(nowMs)),
  );
  return { kind: "kept", photos: kept.length + 1 };
}

const SHOWN = 20;

// Emergencies in this account's region that nobody has opened: what the desk alarms for.
export async function emergencyList(bindings: ServiceBindings, staff: StaffPrincipal): Promise<DeskEmergency[]> {
  return (await openEmergencies(bindings.db, staff.scope, SHOWN)).map(({ villageCode, sentAt, ...one }) => ({
    ...one,
    hazardType: one.hazardType as DeskEmergency["hazardType"],
    sentAt: at(sentAt, draftZone(villageCode)),
  }));
}
