import { z } from "zod";
import { hazardTypeSchema, timeSchema, zoneSchema } from "./common";

export const ticketStatusSchema = z.enum([
  "new",
  "seen",
  "under_review",
  "forwarded",
  "in_handling",
  "closed",
  "invalid",
]);

// Who to call: the regency's or province's BPBD from the contact file, else BNPB's 117.
const contactSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("regency"), name: z.string(), phone: z.string() }),
  z.object({ level: z.literal("province"), name: z.string(), phone: z.string() }),
  z.object({ level: z.literal("national") }),
]);

// The time of the event as the reporter gave it, in the report's zone.
export const eventTimeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dateTime"), localDate: z.iso.date(), localTime: z.string(), zone: zoneSchema }),
  z.object({ kind: z.literal("dateOnly"), localDate: z.iso.date(), zone: zoneSchema }),
  z.object({ kind: z.literal("olderThan30Days") }),
]);

// What anyone with the tracking link sees. Never the reporter's name or number, the coordinates,
// or RT and RW (HF4).
export const trackingSchema = z.object({
  ticketNumber: z.string(),
  sentAt: timeSchema,
  stages: z.array(z.object({ status: ticketStatusSchema, reachedAt: timeSchema.nullable() })),
  // Set aside, with the reason an officer wrote for the reporter. Nothing else staff write is here.
  rejected: z.object({ at: timeSchema, reason: z.string() }).nullable(),
  hazardType: hazardTypeSchema,
  hazardSubtype: z.string().nullable(),
  place: z.object({ villageName: z.string(), districtName: z.string(), regencyName: z.string() }),
  eventTime: eventTimeSchema.nullable(),
  photoCount: z.number().int().nonnegative(),
  contact: contactSchema,
});

export type Tracking = z.infer<typeof trackingSchema>;

// One sent report of this number on this device, newest first, with its tracking secret: only
// its owner is given it.
export const ownReportSchema = z.object({
  ticketNumber: z.string(),
  hazardType: hazardTypeSchema,
  sentAt: timeSchema,
  status: ticketStatusSchema,
  trackingToken: z.string(),
});
