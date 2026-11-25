import {
  askForDocument,
  markDelivered,
  reportDelivery,
  type WaitingNotice,
  waitingNotices,
} from "../adapters/d1/chatNews";
import { newsSources } from "../adapters/d1/news";
import type { WaitingNews } from "../contract/gateway";
import type { ReportVersion } from "../contract/ownReport";
import { NEWS_WAITS_MS, type NewsMessage, newsMessages } from "../domain/chat/news";
import { reporterNews } from "../domain/reporterNews";
import type { ServiceBindings } from "./bindings";
import { message, newsParts, newsText, t } from "./chatWords";
import { chatDocument, type DocumentAnswer } from "./documents";
import { at, draftZone } from "./draftView";
import { trackingToken } from "./tracking";
import { versionsOf } from "./versions";

// The news of a chat: what staff did, worded when a gateway comes for it, and the documents asked for.

// Notices read at once; a gateway comes back for the rest.
const PULL = 50;

const since = (bindings: ServiceBindings) => new Date(bindings.clock.now() - NEWS_WAITS_MS);

const changesOf = (versions: readonly ReportVersion[], version: number | null) =>
  versions.find((one) => one.version === version)?.changes ?? [];

async function worded(bindings: ServiceBindings, news: NewsMessage, of: WaitingNotice): Promise<string> {
  if (news.document !== null)
    return t("whatsapp.document.caption", { ticketNumber: news.ticketNumber, version: news.document });
  const { villageCode, hazardType, reportId } = of;
  const versions = news.corrected === null ? [] : await versionsOf(bindings, news.ticketNumber, villageCode);
  const token = await trackingToken(bindings.settings.keyHmacSecret, reportId);
  return newsText(
    {
      ...news,
      at: at(news.atMs, draftZone(villageCode)),
      changes: changesOf(versions, news.corrected),
      hazardType,
    },
    `${bindings.settings.appOrigin}/lapor/lacak#t=${token}`,
  );
}

// What waits to be sent, as the gateway takes it.
export async function waitingNews(bindings: ServiceBindings): Promise<WaitingNews> {
  const rows = await waitingNotices(bindings.db, since(bindings), PULL);
  const messages = newsMessages(rows);
  // The last act read may go on past what was read: it is told whole the next time.
  const whole = rows.length < PULL ? messages : messages.slice(0, -1);
  const kabar = await Promise.all(
    whole.map(async (news) => {
      const of = rows.find((row) => row.id === news.id) as WaitingNotice;
      const file = news.corrected !== null || news.document !== null;
      const words = news.reply === null ? ("status" as const) : ("balasan" as const);
      return {
        id: String(news.id),
        // The gateway writes a number as 62 and the rest.
        wa: of.number.slice(1),
        jenis: file ? ("pdf" as const) : words,
        teks: await worded(bindings, news, of),
        url: file ? `${bindings.settings.appOrigin}/api/lapor/kabar/${news.id}/berkas` : null,
        nomor: news.ticketNumber,
      };
    }),
  );
  return { kabar };
}

export const newsSent = (bindings: ServiceBindings, gatewayId: string, id: number): Promise<boolean> =>
  markDelivered(bindings.db, id, gatewayId, since(bindings), new Date(bindings.clock.now()));

// The document of news that still waits; once sent, or stopped, there is none.
export async function newsDocument(bindings: ServiceBindings, id: number): Promise<DocumentAnswer> {
  const [news] = newsMessages(await waitingNotices(bindings.db, since(bindings), PULL, id));
  const version = news?.document ?? news?.corrected ?? null;
  return news === undefined || version === null
    ? { kind: "notFound" }
    : chatDocument(bindings, news.ticketNumber, version);
}

export const queueDocument = (bindings: ServiceBindings, ticketNumber: string, version: number): Promise<void> =>
  askForDocument(bindings.db, ticketNumber, version, since(bindings), new Date(bindings.clock.now()));

const LATEST_NEWS = 3;

// The latest of a report's news, for a reporter who asks: what they may read whatever they chose.
export async function latestNews(
  bindings: ServiceBindings,
  report: { readonly ticketNumber: string; readonly villageCode: string; readonly hazardType: string },
): Promise<string> {
  const { ticketNumber, villageCode, hazardType } = report;
  const versions = await versionsOf(bindings, ticketNumber, villageCode);
  const { history, replies } = await newsSources(bindings.db, ticketNumber);
  const corrections = versions
    .filter((one) => one.madeBy === "officer")
    .map((one) => ({ version: one.version, atMs: Date.parse(one.at.utc) }));
  const items = reporterNews(history, replies, corrections)
    .filter((item) => item.kind !== "status" || item.reason !== null)
    .slice(0, LATEST_NEWS);
  return message(
    ...items.map((item) =>
      newsParts({
        status: item.kind === "status" ? { status: item.status, reason: item.reason } : null,
        actions: item.kind === "actions" ? item.actions : [],
        reply: item.kind === "reply" ? item.text : null,
        corrected: item.kind === "correction" ? item.version : null,
        changes: item.kind === "correction" ? changesOf(versions, item.version) : [],
        hazardType,
      }),
    ),
  );
}

// What of a report reaches its reporter's chat, for the desk, with each reply's way there.
export async function deskDelivery(bindings: ServiceBindings, ticketNumber: string, villageCode: string) {
  const found = await reportDelivery(bindings.db, ticketNumber, since(bindings));
  if (found === null) return null;
  const { wanted, waiting, lastSentAt, replies } = found;
  const zone = draftZone(villageCode);
  return {
    report: { wanted, waiting, lastSentAt: lastSentAt && at(lastSentAt, zone) },
    replies: replies.map((one) => {
      if (one.sentAt !== null) return { state: "sent" as const, at: at(one.sentAt, zone) };
      return one.waiting ? { state: "waiting" as const } : null;
    }),
  };
}
