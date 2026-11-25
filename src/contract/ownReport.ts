import { z } from "zod";
import { valueChangeSchema } from "./card";
import { timeSchema } from "./common";
import { trackingSchema } from "./tracking";

// A version of a report: when it was made, by whom, and the values that say something else than in
// the version before. A value never reached is null.
export const reportVersionSchema = z.object({
  version: z.number().int().positive(),
  at: timeSchema,
  madeBy: z.enum(["reporter", "officer"]),
  changes: z.array(valueChangeSchema),
});

export type ReportVersion = z.infer<typeof reportVersionSchema>;

// A report on the phone or session that sent it: what its tracking link shows, the link itself,
// and what only its reporter is given.
export const ownReportDetailSchema = z.object({
  tracking: trackingSchema,
  trackingToken: z.string(),
  // Newest first.
  versions: z.array(reportVersionSchema),
  // Whether news is still taken, until when, or why not.
  followUp: z.discriminatedUnion("state", [
    z.object({ state: z.literal("open"), until: timeSchema }),
    z.object({ state: z.literal("closed"), reason: z.enum(["tooLate", "ended", "tooMany"]) }),
  ]),
});

export type OwnReportDetail = z.infer<typeof ownReportDetailSchema>;

export const followUpSchema = z.object({ draftId: z.uuid() });
