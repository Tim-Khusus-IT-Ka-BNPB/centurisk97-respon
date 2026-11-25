import { z } from "zod";
import { contactSchema } from "./tracking";

// Who a one-tap emergency goes under, and who to call before the phone's place is known.
export const oneTapStartSchema = z.object({ name: z.string(), maskedNumber: z.string(), contact: contactSchema });

export type OneTapStart = z.infer<typeof oneTapStartSchema>;

export const oneTapSentSchema = z.object({
  ticketNumber: z.string(),
  trackingToken: z.string(),
  contact: contactSchema,
});

export type OneTapSent = z.infer<typeof oneTapSentSchema>;
