import { z } from "zod";
import { hazardTypeSchema, timeSchema } from "./common";
import { impactSchema } from "./desk";
import { eventTimeSchema } from "./tracking";

// The public feed (K59, D84 to D86). Strict objects: this is the allow-list of every value that
// may reach a public page, and a test fails on any other. No name, number, ticket, the reporter's
// own text or point, RT, RW or coordinates of the report: a place is its village, a point the
// village's centre.
const feedEntrySchema = z.strictObject({
  // Stands for the entry; made from a report id, so it names no ticket.
  id: z.string(),
  hazardType: hazardTypeSchema,
  hazardSubtype: z.string().nullable(),
  status: z.enum(["in_handling", "closed"]),
  place: z.strictObject({
    villageName: z.string(),
    districtName: z.string(),
    regencyName: z.string(),
    provinceName: z.string(),
  }),
  centre: z.strictObject({ lat: z.number(), lon: z.number() }).nullable(),
  eventTime: eventTimeSchema.nullable(),
  sentAt: timeSchema,
  // The newest report's own figures: a cluster's are never added up (D28).
  impact: impactSchema,
  // How many people reported this one event, from two.
  reporters: z.number().int().min(2).nullable(),
  // Photos of the work an officer marked public.
  proofs: z.array(z.uuid()).max(4),
});

export const feedSchema = z.strictObject({ entries: z.array(feedEntrySchema) });

export type FeedEntry = z.infer<typeof feedEntrySchema>;
export type Feed = z.infer<typeof feedSchema>;
