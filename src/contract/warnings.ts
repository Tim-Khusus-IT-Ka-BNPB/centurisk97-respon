import { z } from "zod";

// What a phone is warned of; no districts when nothing.
export const warningViewSchema = z.object({
  districts: z.array(z.object({ code: z.string(), name: z.string() })),
  hazards: z.number().int().nullable(),
  threshold: z.number().int().nullable(),
});

// The desk's view of the sending: shut with no push keys, paused by staff, and how many phones.
export const warningControlSchema = z.object({
  open: z.boolean(),
  paused: z.boolean(),
  by: z.string().nullable(),
  at: z.string().nullable(),
  phones: z.number().int().nonnegative(),
});

export type WarningControl = z.infer<typeof warningControlSchema>;
