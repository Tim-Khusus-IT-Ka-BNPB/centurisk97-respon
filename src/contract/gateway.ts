import { z } from "zod";

// What a WhatsApp gateway sends here and is told. The gateway signs every call with its key.

const number = z.string().max(40);
// Which door and language a gateway names; here it is always the chat, in Indonesian.
const carried = { channel: z.string().max(20).optional(), language: z.string().max(20).optional() };

export const chatMessageSchema = z.object({
  number,
  ...carried,
  text: z.string().max(12_000).optional(),
  location: z
    .object({ lat: z.number(), lon: z.number(), source: z.string().max(20).optional() })
    .nullable()
    .optional(),
});

export const chatPhotoSchema = z.object({
  number,
  ...carried,
  // A JPEG in base64, with or without its data prefix.
  data: z.string(),
  // When its message was sent, in milliseconds.
  sentAt: z.number().optional(),
});

// What to send back to the number, word for word.
export const chatReplySchema = z.object({ reply: z.string() });

export const chatRefusalSchema = z.object({
  error: z.string(),
  // Sent on to the reporter when there is anything to tell them.
  reply: z.string().optional(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

// News and documents that wait, in the order they are to be sent.
export const waitingNewsSchema = z.object({
  news: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      kind: z.enum(["status", "reply", "document"]),
      // The message, or a document's caption.
      text: z.string(),
      // Where a gateway reads the document, signed as any call of its own.
      url: z.string().nullable(),
      ticketNumber: z.string(),
    }),
  ),
});

export type WaitingNews = z.infer<typeof waitingNewsSchema>;

// The owner's command about a number: allow it, as a BPBD's when `role` says so, or revoke it.
export const pilotChangeSchema = z.object({
  number,
  role: z.literal("bpbd").nullable().optional(),
  regency: z.string().max(120).nullable().optional(),
  revoke: z.boolean().optional(),
});

export const pilotListSchema = z.object({ numbers: z.array(z.string()) });

export const okSchema = z.object({ ok: z.literal(true) });

export const languagesSchema = z.object({ languages: z.array(z.object({ code: z.string(), name: z.string() })) });
