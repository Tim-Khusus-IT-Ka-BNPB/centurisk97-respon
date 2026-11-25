import { z } from "zod";
import { summaryGroupSchema } from "./card";
import { timeSchema } from "./common";
import { trackingSchema } from "./tracking";

const rowSchema = summaryGroupSchema.shape.rows.element;

// A version of a report: when it was made, by whom, and the values that say something else than in
// the version before. A value never reached is null.
export const reportVersionSchema = z.object({
  version: z.number().int().positive(),
  at: timeSchema,
  madeBy: z.enum(["reporter", "officer"]),
  changes: z.array(z.object({ fieldId: z.string(), from: rowSchema.nullable(), to: rowSchema.nullable() })),
});

export type ReportVersion = z.infer<typeof reportVersionSchema>;

// A report on the phone or session that sent it: what its tracking link shows, the link itself,
// and what only its reporter is given.
export const ownReportDetailSchema = z.object({
  tracking: trackingSchema,
  trackingToken: z.string(),
  // Newest first.
  versions: z.array(reportVersionSchema),
});

export type OwnReportDetail = z.infer<typeof ownReportDetailSchema>;
