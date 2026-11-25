import { useEffect, useRef } from "react";
import { Form, useFetcher } from "react-router";
import type { NewsItem, OwnReportDetail } from "../../../src/contract/ownReport";
import { clockTime, longDate } from "../../../src/copy/time";
import { useBusy } from "../../lib/hooks";
import { useText } from "../../lib/text";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";
import { ChangeList } from "./VersionList";

const ICON: Readonly<Record<Exclude<NewsItem["kind"], "status">, IconName>> = {
  reply: "messageSquare",
  actions: "wrench",
  correction: "clipboardCheck",
};

function iconOf(item: NewsItem): IconName {
  if (item.kind !== "status") return ICON[item.kind];
  return item.status === "invalid" ? "circleX" : "circleCheck";
}

// What an item says beyond its heading.
function Told({ item, hazardType }: { readonly item: NewsItem; readonly hazardType: string }) {
  const t = useText();
  switch (item.kind) {
    case "reply":
      return <p className="rounded-control bg-selected px-3 py-2 break-words whitespace-pre-line">{item.text}</p>;
    case "actions":
      return (
        <ul className="flex flex-col">
          {item.actions.map((action) => (
            <li key={action} className="break-words">
              {action}
            </li>
          ))}
        </ul>
      );
    case "correction":
      return <ChangeList changes={item.changes} hazardType={hazardType} />;
    default:
      return item.reason === null ? null : (
        <p className="break-words">{t("tracking.rejected", { reason: item.reason })}</p>
      );
  }
}

function Item({ item, hazardType }: { readonly item: NewsItem; readonly hazardType: string }) {
  const t = useText();
  return (
    <li className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-sunken text-primary">
        <Icon name={iconOf(item)} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">
            {t(item.kind === "status" ? `stage.long.${item.status}` : `news.${item.kind}`)}
          </span>
          {item.isNew ? (
            <span className="rounded-chip bg-primary px-1.5 py-0.5 text-meta font-bold text-on-primary">
              {t("news.new")}
            </span>
          ) : null}
        </p>
        <p className="text-meta text-muted tabular-nums">
          {t("stage.reachedAt", { date: longDate(item.at), time: clockTime(item.at), zone: item.at.zone })}
        </p>
        <Told item={item} hazardType={hazardType} />
      </div>
    </li>
  );
}

// With script the news is read once it is drawn, and keeps its marks for this visit; without, a
// button reads it.
function MarkRead({ unread }: { readonly unread: boolean }) {
  const t = useText();
  const { submit } = useFetcher();
  const posted = useRef(false);
  useEffect(() => {
    if (!unread || posted.current) return;
    posted.current = true;
    submit({ action: "newsRead" }, { method: "post" });
  }, [unread, submit]);
  return unread ? (
    <noscript>
      <Form method="post">
        <Button name="action" value="newsRead">
          {t("news.read")}
        </Button>
      </Form>
    </noscript>
  ) : null;
}

// Stopping the news, or wanting it again; what stays either way is said first.
function Switch({ stopped }: { readonly stopped: boolean }) {
  const t = useText();
  const act = stopped ? "newsStart" : "newsStop";
  const busy = useBusy(act, "action");
  return (
    <Form method="post" preventScrollReset className="flex flex-col items-start gap-3 border-t border-line pt-4">
      <p className="text-meta text-muted">{t(stopped ? "news.stopped" : "news.lead")}</p>
      <Button name="action" value={act} size="min" busyLabel={busy ? t("news.busy") : null}>
        <Icon name={stopped ? "bell" : "bellOff"} className="size-5" />
        {t(stopped ? "news.start" : "news.stop")}
      </Button>
    </Form>
  );
}

// What staff answered and did, the newest first.
export function OwnNews({ report }: { readonly report: OwnReportDetail }) {
  const t = useText();
  const { items, stopped } = report.news;
  const unread = items.filter((item) => item.isNew).length;
  return (
    <section aria-labelledby="own-news" className="flex flex-col gap-4 card-surface p-4 md:p-5">
      <h2 id="own-news" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-card font-bold">
        {t("news.title")}
        {unread === 0 ? null : (
          <span className="text-meta font-semibold text-muted">{t("news.unread", { count: unread })}</span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-3 rounded-control bg-sunken p-4 text-muted">
          <Icon name="inbox" className="shrink-0" />
          {t("news.empty")}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {items.map((item, index) => (
            // Two things done at one moment share a time, so their order is their key.
            // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows and is never reordered
            <Item key={index} item={item} hazardType={report.tracking.hazardType} />
          ))}
        </ol>
      )}
      <MarkRead unread={unread > 0} />
      <Switch stopped={stopped} />
    </section>
  );
}
