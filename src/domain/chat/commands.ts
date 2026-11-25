import { folded, tidy } from "../text";
import { isTicketNumber } from "../ticketNumber";
import { topicGate } from "../topicGate";
import { said } from "./reply";

// What a reporter may write in a chat at any time, beside "kembali" and "batal", which the
// conversation itself knows.

export type Command =
  | {
      readonly kind:
        | "help"
        | "start"
        | "emergency"
        | "repeat"
        | "newsStop"
        | "newsStart"
        | "identity"
        | "dropPhoto"
        | "dataRights";
    }
  | { readonly kind: "status" | "document" | "addNews"; readonly ticketNumber: string | null };

const WORDS = [
  ["help", /^(?:bantuan|menu|help|cara lapor|\?)$/],
  ["start", /^(?:lapor|mulai|lapor bencana|(?:buat )?laporan baru|buat laporan)$/],
  ["emergency", /^(?:lapor )?darurat$/],
  ["repeat", /^(?:ulang|ulangi)$/],
  ["newsStop", /^(?:berhenti|hentikan|stop|matikan) kabar$/],
  ["newsStart", /^(?:nyalakan|hidupkan|mulai) kabar$/],
  ["identity", /^ganti (?:nama|data|identitas)$/],
  ["dropPhoto", /^hapus(?: foto)?(?: terakhir| tadi)?$/],
  ["dataRights", /^(?:tolong |minta )?hapus(?:kan)? (?:semua )?(?:data|nomor|identitas|akun)(?: saya)?$/],
] as const;

const ABOUT_TICKET = [
  ["status", /^(?:cek )?status(?: laporan(?: saya)?)?(?: (\S+))?$/],
  ["document", /^(?:(?:minta|kirim) )?(?:dokumen|pdf)(?: (\S+))?$/],
  ["addNews", /^(?:tambah )?kabar(?: untuk)?(?: (\S+))?$/],
] as const;

export function readCommand(text: string): Command | null {
  const words = said(text);
  for (const [kind, pattern] of WORDS) if (pattern.test(words)) return { kind };
  for (const [kind, pattern] of ABOUT_TICKET) {
    const match = pattern.exec(words);
    if (!match) continue;
    const ticketNumber = match[1]?.toUpperCase() ?? null;
    if (ticketNumber === null || isTicketNumber(ticketNumber)) return { kind, ticketNumber };
  }
  return null;
}

const TICKET = /\bla-\d{6}-\d{2,}\b/i;
const OPENING = /^(?:tambah )?kabar(?: untuk)?(?: |$)/i;

// News told with its ticket in one message: the ticket, and what is left to say.
export function newsWithTicket(text: string): { readonly ticketNumber: string; readonly rest: string } | null {
  const match = TICKET.exec(text);
  if (!match) return null;
  const rest = tidy(text.replace(match[0], "")).replace(OPENING, "");
  return { ticketNumber: match[0].toUpperCase(), rest: rest.replace(/^[,:.;-] ?/, "") };
}

const EVENT = new RegExp(
  `\\b(?:${[
    "banjir",
    "longsor",
    "gempa",
    "tsunami",
    "erupsi",
    "meletus",
    "kebakaran",
    "terbakar",
    "karhutla",
    "puting beliung",
    "angin kencang",
    "kekeringan",
    "abrasi",
    "gelombang",
    "rob",
    "terendam",
    "genangan",
    "roboh",
    "rusak",
    "korban",
    "meninggal",
    "tewas",
    "hilang",
    "luka",
    "terluka",
    "mengungsi",
    "pengungsi",
    "tanggul",
    "jebol",
    "hanyut",
    "terseret",
    "terjebak",
    "ambruk",
    "tumbang",
    "asap",
    "air (?:makin |terus |sudah )?naik",
    "bencana",
  ].join("|")})\\b`,
);

// A message that tells of an event, though no report is open.
export const tellsOfEvent = (text: string): boolean => EVENT.test(folded(text)) && topicGate(text) === null;

const SENTENCE_WORDS = 3;

// While news may still be told of a report, any sentence may be it.
export const mayBeNews = (text: string): boolean =>
  tellsOfEvent(text) || (tidy(text).split(" ").length >= SENTENCE_WORDS && topicGate(text) === null);

const THANKS =
  /^(?:(?:ok|oke|baik|siap|sip|ya)[, ]+)?(?:terima ?kasih|makasih|trims|thanks)(?: (?:banyak|kak|pak|bu|min))*$|^(?:ok|oke|baik|siap|sip|mantap)$/;

export const saysThanks = (text: string): boolean => THANKS.test(said(text));
