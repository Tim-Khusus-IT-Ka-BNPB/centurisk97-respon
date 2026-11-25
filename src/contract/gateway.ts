import { z } from "zod";

// What a WhatsApp gateway says and is told, in upstream's own shapes and names (ROADMAP section 7),
// so the gateway in use can be pointed here. These names live in this file and its routes only.

const wa = z.string().max(40);
// Which door and language a gateway names; here it is always the chat, in Indonesian.
const carried = { saluran: z.string().max(20).optional(), bahasa: z.string().max(20).optional() };

export const chatMessageSchema = z.object({
  wa,
  ...carried,
  teks: z.string().max(12_000).optional(),
  lokasi: z
    .object({ lat: z.number(), lon: z.number(), sumber: z.string().max(20).optional() })
    .nullable()
    .optional(),
});

export const chatPhotoSchema = z.object({
  wa,
  ...carried,
  // A JPEG in base64, with or without its data prefix.
  data: z.string(),
  // When its message was sent, in milliseconds.
  waktu: z.number().optional(),
});

// What to send back to the number, word for word.
export const chatReplySchema = z.object({ teksWa: z.string() });

export const chatRefusalSchema = z.object({
  galat: z.string(),
  // Sent on to the reporter when there is anything to tell them.
  teksWa: z.string().optional(),
  sisaDetik: z.number().int().nonnegative().optional(),
});

// News and documents that wait, in the order they are to be sent.
export const waitingNewsSchema = z.object({
  kabar: z.array(
    z.object({
      id: z.string(),
      wa: z.string(),
      jenis: z.enum(["status", "balasan", "pdf"]),
      // The message, or a document's caption.
      teks: z.string(),
      // Where a gateway reads the document, signed as any call of its own.
      url: z.string().nullable(),
      nomor: z.string(),
    }),
  ),
});

export type WaitingNews = z.infer<typeof waitingNewsSchema>;

// The owner's command about a number: allow it, as a BPBD's when `peran` says so, or take it away.
export const pilotChangeSchema = z.object({
  wa,
  peran: z.literal("bpbd").nullable().optional(),
  kab: z.string().max(120).nullable().optional(),
  cabut: z.boolean().optional(),
});

export const pilotListSchema = z.object({ wa: z.array(z.string()) });

export const okSchema = z.object({ ok: z.literal(true) });

export const languagesSchema = z.object({ bahasa: z.array(z.object({ kode: z.string(), nama: z.string() })) });
