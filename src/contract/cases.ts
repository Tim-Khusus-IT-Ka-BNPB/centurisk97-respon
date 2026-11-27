import { z } from "zod";
import { CASE_KINDS } from "../domain/caseSpec";
import { timeSchema } from "./common";

const id = z.string().regex(/^[0-9a-f]{16}$/);
const point = z.strictObject({ lat: z.number(), lon: z.number() });
const values = z.record(z.string(), z.unknown());
const fileStatus = z.enum(["open", "proposed", "done", "doneNoted"]);

// One follow-up file as its reader may see it (M09): the team and its keepers in full, BNPB with
// personal values masked, a province by its totals only.
export const caseViewSchema = z.object({
  file: z.object({
    id,
    ticketNumber: z.string(),
    regencyCode: z.string(),
    status: fileStatus,
    fields: values,
    nil: z.array(z.string()),
    revision: z.number().int(),
    openedAt: timeSchema,
  }),
  access: z.enum(["lead", "team", "bnpb", "province"]),
  // The WIB day the totals are counted on.
  day: z.string(),
  recap: z.record(z.string(), z.number().nullable()),
  final: z.object({
    status: z.enum(["done", "doneNoted"]),
    reasons: z.array(z.object({ metric: z.string(), value: z.number().nullable() })),
    notRecorded: z.array(z.string()),
  }),
  // The metrics that have records, and so cannot be marked none.
  filled: z.array(z.string()),
  records: z.array(
    z.object({
      id,
      kind: z.enum(CASE_KINDS),
      seq: z.number().int(),
      data: values,
      personal: values,
      // As typed, and as shown: typed, or from its photos.
      point: point.nullable(),
      shownPoint: point.nullable(),
      cancelledReason: z.string().nullable(),
      revision: z.number().int(),
      by: z.string(),
      updatedAt: timeSchema,
      media: z.array(
        z.object({ id: z.string(), kind: z.enum(["photo", "face", "video"]), badge: z.enum(["gps", "exif", "none"]) }),
      ),
      flags: z.array(z.enum(["noPoint", "farPhoto", "oldPhoto", "samePoint", "sameNik", "outsideRegency"])),
      missingPhotos: z.object({ photo: z.number().int(), face: z.number().int() }),
    }),
  ),
  members: z.array(
    z.object({ id, name: z.string(), number: z.string(), active: z.boolean(), linkPending: z.boolean() }),
  ),
  // Each closing sealed, oldest first: when, by whom, its fingerprint, the state and the day it ended.
  versions: z.array(
    z.object({
      version: z.number().int(),
      at: timeSchema,
      by: z.string(),
      fingerprint: z.string(),
      final: z.object({
        status: z.enum(["done", "doneNoted"]),
        reasons: z.array(z.object({ metric: z.string(), value: z.number().nullable() })),
        notRecorded: z.array(z.string()),
      }),
      closing: z.object({ endedOn: z.string(), note: z.string().nullable() }),
    }),
  ),
});
export type CaseView = z.infer<typeof caseViewSchema>;

export const caseListSchema = z.object({
  files: z.array(
    z.object({ id, ticketNumber: z.string(), regencyCode: z.string(), status: fileStatus, openedAt: timeSchema }),
  ),
});

export const recordInputSchema = z.object({
  kind: z.enum(CASE_KINDS),
  values,
  point: point.nullable().optional(),
  clientId: z
    .string()
    .regex(/^[0-9a-zA-Z-]{8,40}$/)
    .optional(),
});
export const recordChangeSchema = z.object({ values, point: point.nullable().optional(), revision: z.number().int() });
