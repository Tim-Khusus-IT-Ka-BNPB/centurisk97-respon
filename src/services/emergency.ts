import {
  keepOfflineSend,
  lastOneTap,
  offlineTicket,
  oneTapsOfDay,
  openEmergencies,
  sendOneTap,
} from "../adapters/d1/emergency";
import { knownProfiles, latestConsent, type ProfileRow } from "../adapters/d1/reporters";
import { ownReports, reportByTicket } from "../adapters/d1/reports";
import { ticketNumberOf } from "../adapters/d1/send";
import type { DeskEmergency } from "../contract/desk";
import type { OneTapSent, OneTapStart } from "../contract/emergency";
import { emergencyStates, oneTapDayOpensAt, oneTapOpensAt, type VictimAnswer } from "../domain/emergency";
import type { FieldStates, PlacePoint, PlaceValue } from "../domain/fieldState";
import { completePercent } from "../domain/fields/applicable";
import type { HazardTypeId } from "../domain/hazards";
import { maskNumber } from "../domain/phoneNumber";
import { formatTicketNumber, ticketDay } from "../domain/ticketNumber";
import { DAY_MS } from "../domain/time";
import { EMPTY_CONTENT } from "../domain/turn/content";
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
  readonly takenAtMs?: number;
  readonly clientId?: string;
};

// A report kept on a phone this long is still sent, with the time it was made.
const OFFLINE_KEPT_MS = 14 * DAY_MS;

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
  const takenMs =
    reading.takenAtMs !== undefined && reading.takenAtMs <= nowMs && reading.takenAtMs >= nowMs - OFFLINE_KEPT_MS
      ? reading.takenAtMs
      : nowMs;
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
    takenMs,
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
      door: "web",
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
    },
    profile.id,
    day,
  );
  if (ticketNumber === null)
    return { kind: "limit", refusal: { limitId: "oneTap.device", retryAtMs: await deviceOpens() } };
  if (reading.clientId) await keepOfflineSend(db, reading.clientId, ticketNumber, new Date(nowMs));
  return { kind: "sent", ticketNumber, trackingToken: token, contact: await contactOf(bindings, place) };
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
