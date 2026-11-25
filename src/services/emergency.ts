import { lastOneTap, oneTapsOfDay, openEmergencies, sendOneTap } from "../adapters/d1/emergency";
import { knownProfiles, latestConsent, type ProfileRow } from "../adapters/d1/reporters";
import { ownReports, reportByTicket } from "../adapters/d1/reports";
import { ticketNumberOf } from "../adapters/d1/send";
import type { DeskEmergency } from "../contract/desk";
import type { OneTapSent, OneTapStart } from "../contract/emergency";
import { emergencyStates, oneTapDayOpensAt, oneTapOpensAt } from "../domain/emergency";
import type { FieldStates, PlacePoint } from "../domain/fieldState";
import { completePercent } from "../domain/fields/applicable";
import { maskNumber } from "../domain/phoneNumber";
import { formatTicketNumber, ticketDay } from "../domain/ticketNumber";
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
export async function oneTapEmergency(
  bindings: ServiceBindings,
  principal: Reporter,
  address: string,
  reading: PlacePoint,
): Promise<OneTapAnswer> {
  const db = bindings.db;
  const profile = await reporterOf(bindings, principal);
  const consent = profile === null ? null : await latestConsent(db, profile.id);
  if (profile === null || consent === null) return { kind: "unknownReporter" };
  const nowMs = bindings.clock.now();
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
    { place: { state: "value", value: place, origin: "system" }, hazardType: { state: "notYetKnown" } },
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
      door: "web",
      // Its kind is not known yet; "other" is never offered, so it stands for that alone.
      hazardType: "other",
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
      emergency: { kind: "oneTap", victims: "unknown" },
    },
    profile.id,
    day,
  );
  if (ticketNumber === null)
    return { kind: "limit", refusal: { limitId: "oneTap.device", retryAtMs: await deviceOpens() } };
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
