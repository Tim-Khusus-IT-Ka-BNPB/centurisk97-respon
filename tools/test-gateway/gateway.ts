import { signedText } from "../../src/domain/gateway.ts";
import { sha256Hex, signText } from "../../src/platform/keys.ts";

// What the WhatsApp gateway does with a message, without WhatsApp: the number's messages go to the
// app signed, its answers are kept as that number's chat. Upstream's gateway (`lapor_wa.mjs`) is the
// behaviour; its one difference here is that a 403 sends nothing.

export type Entry = {
  readonly id: number;
  readonly from: "reporter" | "service";
  readonly kind: "text" | "location" | "photo" | "document";
  readonly text: string;
  readonly at: string;
  // Where the file of a photo or a document is read.
  readonly file?: string;
};

type File = { readonly bytes: Uint8Array; readonly mime: string; readonly name: string };
type Call = { readonly at: string; readonly method: string; readonly path: string; readonly status: number };

export type Settings = {
  // Where the app answers, and the origin it calls itself by.
  readonly app: string;
  readonly id: string;
  readonly secret: string;
  // The number that may say who is served.
  readonly owner: string;
};

type OwnerCommand = { readonly wa: string; readonly peran?: "bpbd"; readonly kab?: string; readonly cabut?: true };

// "lapor izin 0800 ... [bpbd Kab. X]" or "lapor cabut 0800 ...", in upstream's words.
function ownerCommand(text: string): OwnerCommand | null {
  const match = /^lapor (izin|cabut) (\+?[\d .-]+\d)(?: bpbd (.+))?$/i.exec(text.trim());
  const wa = match && numberOf(match[2] as string);
  if (!wa) return null;
  if (match[1]?.toLowerCase() === "cabut") return { wa, cabut: true };
  return match[3] === undefined ? { wa } : { wa, peran: "bpbd", kab: match[3].trim() };
}

type News = {
  readonly id: string;
  readonly wa: string;
  readonly teks: string;
  readonly url: string | null;
  readonly nomor: string;
};

const DOWN = "Layanan lapor sedang gangguan, coba lagi beberapa menit lagi.";
const OWN_NUMBERS = /^62800\d{6,10}$/;

// Only numbers of the toll-free service prefix, which is no person's phone.
export function numberOf(typed: string): string | null {
  const digits = typed.replace(/\D/g, "").replace(/^0/, "62");
  return OWN_NUMBERS.test(digits) ? digits : null;
}

export function createGateway(settings: Settings) {
  const chats = new Map<string, Entry[]>();
  const files = new Map<string, File>();
  const calls: Call[] = [];
  const queues = new Map<string, Promise<unknown>>();
  let entries = 0;

  const keep = (number: string, entry: Omit<Entry, "id" | "at">) => {
    entries += 1;
    chats.set(number, [...(chats.get(number) ?? []), { ...entry, id: entries, at: new Date().toISOString() }]);
  };
  const keepFile = (file: File) => {
    const id = crypto.randomUUID();
    files.set(id, file);
    return `/api/files/${id}`;
  };

  async function call(method: string, path: string, body?: unknown, messageId: string = crypto.randomUUID()) {
    const text = body === undefined ? "" : JSON.stringify(body);
    const signed = { method, path, timeMs: Date.now(), messageId, bodyHash: await sha256Hex(text) };
    const init: RequestInit = {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "x-gateway-id": settings.id,
        "x-gateway-time": String(signed.timeMs),
        "x-gateway-message": messageId,
        "x-gateway-signature": await signText(settings.secret, signedText(signed)),
      },
      signal: AbortSignal.timeout(45_000),
    };
    if (body !== undefined) init.body = text;
    const response = await fetch(new URL(path, settings.app), init);
    calls.push({ at: new Date().toISOString(), method, path, status: response.status });
    return response;
  }

  // One number's messages are handled one after another, as a person sent them.
  function inTurn<T>(number: string, work: () => Promise<T>): Promise<T> {
    const next = (queues.get(number) ?? Promise.resolve()).then(work, work);
    queues.set(number, next);
    return next;
  }

  async function answer(number: string, path: string, body: unknown, messageId?: string): Promise<number> {
    try {
      const response = await call("POST", path, body, messageId);
      const { teksWa } = (await response.json().catch(() => ({}))) as { teksWa?: string };
      // A number that is not allowed, and a message already taken, get nothing.
      if (response.status === 403 || (response.status === 409 && !teksWa)) return response.status;
      keep(number, { from: "service", kind: "text", text: teksWa || DOWN });
      return response.status;
    } catch {
      keep(number, { from: "service", kind: "text", text: DOWN });
      return 0;
    }
  }

  // The owner's command, which only their own number may give.
  async function command(number: string, said: OwnerCommand): Promise<number> {
    const response = await call("POST", "/api/izin", said);
    const done = said.cabut ? "taken away" : "allowed";
    keep(number, {
      from: "service",
      kind: "text",
      text: response.ok ? `*Number ${done}*` : `*Not saved* (HTTP ${response.status})`,
    });
    return response.status;
  }

  const say = (number: string, text: string, messageId?: string) =>
    inTurn(number, () => {
      keep(number, { from: "reporter", kind: "text", text });
      const said = number === settings.owner ? ownerCommand(text) : null;
      if (said) return command(number, said);
      return answer(number, "/api/pesan", { wa: number, saluran: "wa", teks: text }, messageId);
    });

  const share = (number: string, lat: number, lon: number) =>
    inTurn(number, () => {
      keep(number, { from: "reporter", kind: "location", text: `${lat}, ${lon}` });
      return answer(number, "/api/pesan", { wa: number, saluran: "wa", lokasi: { lat, lon, sumber: "wa" } });
    });

  const photo = (number: string, base64: string, caption: string) =>
    inTurn(number, async () => {
      const bytes = new Uint8Array(Buffer.from(base64, "base64"));
      keep(number, {
        from: "reporter",
        kind: "photo",
        text: caption,
        file: keepFile({ bytes, mime: "image/jpeg", name: "photo.jpg" }),
      });
      const status = await answer(number, "/api/foto", { wa: number, data: base64, waktu: Date.now() });
      if (caption === "") return status;
      return answer(number, "/api/pesan", { wa: number, saluran: "wa", teks: caption });
    });

  // One document of news, read with a signature of our own.
  async function document(url: string, ticket: string): Promise<string | null> {
    const { origin, pathname, search } = new URL(url);
    if (origin !== new URL(settings.app).origin) return null;
    const response = await call("GET", `${pathname}${search}`);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return keepFile({ bytes, mime: "application/pdf", name: `Laporan ${ticket}.pdf` });
  }

  // Sends what waits and marks each as sent, as the gateway does every minute.
  async function pull(): Promise<number> {
    const response = await call("GET", "/api/kabar");
    if (!response.ok) return 0;
    const { kabar } = (await response.json()) as { kabar: News[] };
    let sent = 0;
    for (const news of kabar) {
      const file = news.url === null ? undefined : ((await document(news.url, news.nomor)) ?? undefined);
      if (news.url !== null && file === undefined) continue;
      const kind = file === undefined ? "text" : "document";
      keep(news.wa, { from: "service", kind, text: news.teks, ...(file === undefined ? {} : { file }) });
      await call("POST", `/api/kabar/${encodeURIComponent(news.id)}/terkirim`, {});
      sent += 1;
    }
    return sent;
  }

  return { chats, files, calls, say, share, photo, pull };
}

export type Gateway = ReturnType<typeof createGateway>;
