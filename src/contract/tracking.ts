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
export const contactSchema = z.discriminatedUnion("level", [
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
  // Set aside, with the reason an officer wrote for the reporter. Of what else staff write, only the
  // tracking page's replies (trackedSchema).
  rejected: z.object({ at: timeSchema, reason: z.string() }).nullable(),
  // What was done, and once the report is closed the photos of it, each marked when it was
  // forwarded to the officer rather than taken by them.
  actions: z.array(z.string()),
  proofs: z.array(z.object({ proofId: z.string(), at: timeSchema, forwarded: z.boolean() })),
  hazardType: hazardTypeSchema,
  hazardSubtype: z.string().nullable(),
  place: z.object({ villageName: z.string(), districtName: z.string(), regencyName: z.string() }),
  eventTime: eventTimeSchema.nullable(),
  photoCount: z.number().int().nonnegative(),
  contact: contactSchema,
});

export type Tracking = z.infer<typeof trackingSchema>;

// What the tracking page shows: the same, and what staff answered the reporter, newest first. Never
// who wrote it, so anyone holding the link reads the words alone.
export const trackedSchema = trackingSchema.extend({
  replies: z.array(z.object({ text: z.string(), at: timeSchema })),
});

export type Tracked = z.infer<typeof trackedSchema>;

// One sent report of this number on this device, newest first, with its tracking secret: only
// its owner is given it.
export const ownReportSchema = z.object({
  ticketNumber: z.string(),
  hazardType: hazardTypeSchema,
  sentAt: timeSchema,
  status: ticketStatusSchema,
  trackingToken: z.string(),
  // What staff did that this reporter has not read.
  unread: z.number().int().nonnegative(),
});
