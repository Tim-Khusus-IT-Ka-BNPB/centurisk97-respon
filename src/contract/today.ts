import { z } from "zod";
import { hazardTypeSchema, timeSchema } from "./common";
import { eventTimeSchema } from "./tracking";

const range = z.strictObject({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() });

// The public today page (upstream lapor-kejadian, row 36): events verified by the BPBD of their
// region in the last 24 hours, built from an allow-list only. Never a name, a number, a ticket or the
// reporter's own point: the place stands at its village's centre.
export const todaySchema = z.strictObject({
  events: z.array(
    z.strictObject({
      id: z.string().regex(/^[0-9a-f]{10}$/),
      hazardType: hazardTypeSchema,
      hazardSubtype: z.string().nullable(),
      // To the hour only.
      eventTime: eventTimeSchema.nullable(),
      place: z.strictObject({
        villageName: z.string(),
        districtName: z.string(),
        regencyName: z.string(),
        provinceName: z.string(),
      }),
      centre: z.strictObject({ lat: z.number(), lon: z.number() }).nullable(),
      // Shown from two reporters only.
      reporters: z.number().int().min(2).nullable(),
      verifiedBy: z.strictObject({ level: z.enum(["regency", "province"]), name: z.string() }),
      verifiedAt: timeSchema,
      impact: z.strictObject({
        dead: range.optional(),
        missing: range.optional(),
        injured: range.optional(),
        displaced: range.optional(),
        houses: range.optional(),
      }),
    }),
  ),
});

export type Today = z.infer<typeof todaySchema>;
