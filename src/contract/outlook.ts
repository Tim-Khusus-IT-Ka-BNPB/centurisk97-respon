import { z } from "zod";
import { contactSchema } from "./tracking";

// 0 Normal, 1 Waspada, 2 Siaga, 3 Awas: upstream's levels, never recomputed.
const levelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A regency's three days from upstream's outlook (K87). Labels and advice are upstream's content.
export const outlookSchema = z.strictObject({
  regencyName: z.string(),
  provinceName: z.string(),
  madeAt: z.string(),
  days: z.array(
    z.strictObject({
      date: dateSchema,
      rainMm: z.number().int().nonnegative().nullable(),
      rainLevel: levelSchema.nullable(),
      threats: z.array(z.strictObject({ code: z.string(), label: z.string(), level: levelSchema })),
    }),
  ),
  advice: z.array(z.strictObject({ date: dateSchema, text: z.string() })),
  contact: contactSchema,
});

export type OutlookView = z.infer<typeof outlookSchema>;
