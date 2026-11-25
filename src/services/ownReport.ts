import { markNewsRead, newsSources, newsState, setNewsStopped } from "../adapters/d1/news";
import type { NewsItem, OwnReportDetail, ReportVersion } from "../contract/ownReport";
import { followUpClosesAt, followUpRefusal } from "../domain/followUp";
import { isUnread, reporterNews } from "../domain/reporterNews";
import type { Principal } from "../ports/identity";
import type { ServiceBindings } from "./bindings";
import { at, draftZone } from "./draftView";
import { checkLimits, type LimitRefusal } from "./limits";
import { ownedReport, trackingOf, trackingToken } from "./tracking";
import { versionsOf } from "./versions";

export type OwnReportAnswer =
  | { readonly kind: "ok"; readonly body: OwnReportDetail }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// A report on the phone or session that sent it. Anyone else is told it does not exist.
export async function readOwnReport(
  bindings: ServiceBindings,
  principal: Principal,
  address: string,
  ticketNumber: string,
): Promise<OwnReportAnswer> {
  const refusal = await checkLimits(bindings, [["address.draftReads", { kind: "address", bucket: address }]]);
  if (refusal) return { kind: "limit", refusal };
  const report = await ownedReport(bindings, principal, ticketNumber);
  if (report === null) return { kind: "notFound" };
  const zone = draftZone(report.villageCode);
  const [tracking, token, versions, state, sources] = await Promise.all([
    trackingOf(bindings, report),
    trackingToken(bindings.settings.keyHmacSecret, report.id),
    versionsOf(bindings, ticketNumber, report.villageCode),
    newsState(bindings.db, ticketNumber),
    newsSources(bindings.db, ticketNumber),
  ]);
  const corrections = versions
    .filter((one) => one.madeBy === "officer")
    .map((one) => ({ version: one.version, atMs: Date.parse(one.at.utc) }));
  const items = reporterNews(sources.history, sources.replies, corrections).map(({ atMs, ...item }): NewsItem => {
    const shown = { at: at(atMs, zone), isNew: isUnread(atMs, state.readAtMs, state.stopped) };
    switch (item.kind) {
      case "correction":
        return {
          ...item,
          ...shown,
          changes: (versions.find((one) => one.version === item.version) as ReportVersion).changes,
        };
      case "actions":
        return { ...item, ...shown, actions: [...item.actions] };
      default:
        return { ...item, ...shown };
    }
  });
  const sentAtMs = report.sentAt.getTime();
  const reason = followUpRefusal({ sentAtMs, status: report.status, versions: versions.length }, bindings.clock.now());
  return {
    kind: "ok",
    body: {
      tracking,
      trackingToken: token,
      versions,
      news: { stopped: state.stopped, items },
      followUp:
        reason === null ? { state: "open", until: at(followUpClosesAt(sentAtMs), zone) } : { state: "closed", reason },
    },
  };
}

export type NewsAnswer =
  | { readonly kind: "ok" }
  | { readonly kind: "notFound" }
  | { readonly kind: "limit"; readonly refusal: LimitRefusal };

// The reporter's own act on their news: read up to now, stopped, or wanted again.
export async function actOnNews(
  bindings: ServiceBindings,
  principal: Principal,
  ticketNumber: string,
  act: "read" | "stop" | "start",
): Promise<NewsAnswer> {
  const report = await ownedReport(bindings, principal, ticketNumber);
  if (report === null) return { kind: "notFound" };
  const refusal = await checkLimits(bindings, [
    ["news.hour", { kind: "numberSlot", numberKey: report.numberKey, ownerSlot: report.ownerSlot }],
  ]);
  if (refusal) return { kind: "limit", refusal };
  const now = new Date(bindings.clock.now());
  if (act === "read") await markNewsRead(bindings.db, report.id, now);
  else await setNewsStopped(bindings.db, report.id, act === "stop", now);
  return { kind: "ok" };
}
