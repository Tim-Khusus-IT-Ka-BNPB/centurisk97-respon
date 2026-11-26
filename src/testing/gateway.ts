import { signedText } from "../domain/gateway";
import { hmacKey, sha256Hex, signText } from "../platform/keys";
import { freshNumber, query } from "./api";

const TEST_GATEWAY = { id: "uji-1", secret: "uji-gateway-secret-at-least-32-bytes-long" } as const;
export const GATEWAY_SECRETS = `${TEST_GATEWAY.id}=${TEST_GATEWAY.secret}`;

type Fetch = (request: Request) => Response | Promise<Response>;

export type GatewayOptions = {
  readonly id?: string;
  readonly secret?: string;
  readonly timeMs?: number;
  readonly messageId?: string;
  // Sent in place of what was signed.
  readonly tampered?: string;
  readonly now?: () => number;
};

// A gateway as the Worker meets it: signs each call with its own secret and a message id of its own.
export function gateway(fetchApi: Fetch, defaults: GatewayOptions = {}) {
  const request = async (method: string, path: string, body?: unknown, options: GatewayOptions = {}) => {
    const all = { ...TEST_GATEWAY, ...defaults, ...options };
    const text = body === undefined ? "" : JSON.stringify(body);
    const call = {
      method,
      path: `/api/lapor${path}`,
      timeMs: all.timeMs ?? (all.now ?? Date.now)(),
      messageId: all.messageId ?? crypto.randomUUID(),
      bodyHash: await sha256Hex(text),
    };
    const init: RequestInit = {
      method,
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "content-type": "application/json",
        "x-gateway-id": all.id,
        "x-gateway-time": String(call.timeMs),
        "x-gateway-message": call.messageId,
        "x-gateway-signature": await signText(all.secret, signedText(call)),
      },
    };
    if (body !== undefined) init.body = all.tampered ?? text;
    return fetchApi(new Request(`http://localhost${call.path}`, init));
  };
  const call = async (method: string, path: string, body?: unknown, options: GatewayOptions = {}) => {
    const response = await request(method, path, body, options);
    const json = (await response.json()) as Record<string, unknown>;
    return { status: response.status, json, text: String(json.teksWa ?? ""), headers: response.headers };
  };
  return { request, call };
}

const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

export const numberKey = (number: string) => hmacKey(import.meta.env.KEY_HMAC_SECRET as string, "number", number);

// Puts a number on the pilot list.
export async function allow(number: string, officerRegency: string | null = null): Promise<void> {
  await query`insert into pilot_number (number_key, number, officer_regency, added_by, added_at)
    values (${await numberKey(number)}, ${number}, ${officerRegency}, 'uji', '2026-11-25T00:00:00.000Z')
    on conflict (number_key) do nothing`;
}

// One reporter's chat: each call is a message they send, answered with what they receive.
export function chat(fetchApi: Fetch, options: GatewayOptions = {}, number = freshNumber().stored) {
  const machine = gateway(fetchApi, options);
  // The gateway writes a number as 62 and the rest.
  const wa = number.slice(1);
  let allowed: Promise<void> | null = null;
  const call = async (method: string, path: string, body: unknown) => {
    allowed ??= allow(number);
    await allowed;
    return machine.call(method, path, body);
  };
  return {
    number,
    send: (teks: string) => call("POST", "/pesan", { wa, saluran: "wa", teks }),
    share: (lat: number, lon: number) =>
      call("POST", "/pesan", { wa, saluran: "wa", lokasi: { lat, lon, sumber: "wa" } }),
    photo: (bytes: Uint8Array, waktu?: number) => call("POST", "/foto", { wa, data: base64(bytes), waktu }),
  };
}

// What a person answers to each question, read from the message itself: the first way out it names.
async function answerOn(
  one: ReturnType<typeof chat>,
  first: string,
  answers: readonly (readonly [RegExp, string])[],
  until: RegExp,
  max = 60,
): Promise<string> {
  let text = first;
  for (let turn = 0; turn < max; turn += 1) {
    if (until.test(text)) return text;
    const answer = answers.find(([question]) => question.test(text));
    if (!answer) throw new Error(`No answer for: ${text}`);
    ({ text } = await one.send(answer[1]));
  }
  throw new Error(`Not reached after ${max} answers: ${text}`);
}

// Inside a seeded village of Aceh Utara.
export const VILLAGE = { lat: 5.14705, lon: 97.0482 } as const;

// The plainest way through a report: the first answer of each list, none or not known of the rest.
export const PLAIN: readonly (readonly [RegExp, string])[] = [
  [/^\*RT dan RW/m, "tidak tahu"],
  // Offered a report nearby, the plain walk tells of its own event.
  [/^\*Kejadian yang sama\?/m, "bukan"],
  [/^\*Jenis bencana/m, "1"],
  [/^\*Kronologi tersusun/m, "lanjut"],
  [/^\*Waktu kejadian/m, "1 07.00"],
  [/Balas \d angka berurutan/, "tidak ada"],
  [/\*tidak tahu\* bila belum tahu/, "tidak tahu"],
  [/Balas dengan angkanya|Boleh lebih dari satu/, "1"],
  [/^\*Foto kejadian/m, "1"],
];

type Chat = ReturnType<typeof chat>;

// Who reports, and the place shared: the chat stands at RT and RW.
export async function known(one: Chat, name = "Uji Satu"): Promise<string> {
  for (const text of ["lapor", "1", "1", name]) await one.send(text);
  await one.share(VILLAGE.lat, VILLAGE.lon);
  return (await one.send("1")).text;
}

export const reach = async (one: Chat, until: RegExp, answers: typeof PLAIN = []): Promise<string> =>
  answerOn(one, (await one.send("ulangi")).text, [...answers, ...PLAIN], until);

// A report sent from a new chat, and its ticket.
export async function sent(one: Chat, answers: typeof PLAIN = []): Promise<string> {
  await known(one);
  await reach(one, /^\*Ringkasan laporan/m, answers);
  const { text } = await one.send("1");
  return (/LA-\d{6}-\d{2,}/.exec(text) as RegExpExecArray)[0];
}
