import { z } from "zod";
import { valueChangeSchema } from "./card";
import { timeSchema } from "./common";
import { ticketStatusSchema, trackingSchema } from "./tracking";

// A version of a report: when it was made, by whom, and the values that say something else than in
// the version before. A value never reached is null.
export const reportVersionSchema = z.object({
  version: z.number().int().positive(),
  at: timeSchema,
  madeBy: z.enum(["reporter", "officer"]),
  changes: z.array(valueChangeSchema),
});

// What staff did that the reporter is told. An officer is never named.
const newsItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("status"),
    at: timeSchema,
    isNew: z.boolean(),
    status: ticketStatusSchema,
    // Why the report was set aside, in the officer's words for the reporter.
    reason: z.string().nullable(),
  }),
  z.object({ kind: z.literal("reply"), at: timeSchema, isNew: z.boolean(), text: z.string() }),
  z.object({ kind: z.literal("actions"), at: timeSchema, isNew: z.boolean(), actions: z.array(z.string()) }),
  z.object({
    kind: z.literal("correction"),
    at: timeSchema,
    isNew: z.boolean(),
    version: z.number().int(),
    changes: z.array(valueChangeSchema),
  }),
]);

export type NewsItem = z.infer<typeof newsItemSchema>;

export type ReportVersion = z.infer<typeof reportVersionSchema>;

// A report on the phone or session that sent it: what its tracking link shows, the link itself,
// and what only its reporter is given.
export const ownReportDetailSchema = z.object({
  tracking: trackingSchema,
  trackingToken: z.string(),
  // Newest first.
  versions: z.array(reportVersionSchema),
  // The newest first. Stopped, nothing is marked new; what was written stays readable.
  news: z.object({ stopped: z.boolean(), items: z.array(newsItemSchema) }),
  // Whether news is still taken, until when, or why not.
  followUp: z.discriminatedUnion("state", [
    z.object({ state: z.literal("open"), until: timeSchema }),
    z.object({ state: z.literal("closed"), reason: z.enum(["tooLate", "ended", "tooMany"]) }),
  ]),
});

export type OwnReportDetail = z.infer<typeof ownReportDetailSchema>;

export const followUpSchema = z.object({ draftId: z.uuid() });
