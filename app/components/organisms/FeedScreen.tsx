import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import type { Feed, FeedEntry, Official } from "../../../src/contract/publicFeed";
import { hazardKey } from "../../../src/copy/hazardKey";
import { FEED_PERIODS, type FeedPeriod } from "../../../src/domain/feedPeriod";
import { SELECTABLE_HAZARD_TYPES } from "../../../src/domain/hazards";
import { provinceRings } from "../../../src/domain/provinceRings";
import { cn } from "../../lib/cn";
import { feedMarkers } from "../../lib/deskMap";
import { isLimit } from "../../lib/envelope";
import { type Followed, followed, toggleFollow } from "../../lib/follow";
import { hazardIcon } from "../../lib/hazardIcons";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { SigapSays } from "../molecules/Sigap";
import { eventShort, Impact, StatusDot, whenShort } from "./desk/parts";
import { FeedMap } from "./FeedMap";
import { OfficialEvents } from "./OfficialEvents";

export const chip =
  "inline-flex min-h-target-min shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-ink no-underline transition-colors duration-100 motion-reduce:transition-none hover:border-control aria-[current=true]:border-primary aria-[current=true]:bg-selected aria-[current=true]:font-semibold aria-[current=true]:text-primary";

// The feed's query: a hazard, a period other than all, or neither. Each filter keeps the other.
export function feedQuery(hazard: string | null, period: FeedPeriod): string {
  const parts = [...(hazard === null ? [] : [`hazard=${hazard}`]), ...(period === "all" ? [] : [`period=${period}`])];
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

function Filters({ hazard, period }: { readonly hazard: string | null; readonly period: FeedPeriod }) {
  const t = useText();
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label={t("feed.period.label")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
        {FEED_PERIODS.map((id) => (
          <Link
            key={id}
            to={`/feed${feedQuery(hazard, id)}`}
            aria-current={period === id ? "true" : undefined}
            className={chip}
          >
            <Icon name="clock" className="size-4" />
            {t(`feed.period.${id}`)}
          </Link>
        ))}
      </nav>
      <nav aria-label={t("feed.filter.label")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
        <Link
          to={`/feed${feedQuery(null, period)}`}
          aria-current={hazard === null ? "true" : undefined}
          className={chip}
        >
          {t("feed.filter.all")}
        </Link>
        {SELECTABLE_HAZARD_TYPES.map((id) => (
          <Link
            key={id}
            to={`/feed${feedQuery(id, period)}`}
            aria-current={hazard === id ? "true" : undefined}
            className={chip}
          >
            <Icon name={hazardIcon(id)} className="size-4" />
            {t(hazardKey(id))}
          </Link>
        ))}
      </nav>
    </div>
  );
}

// Follow an event on this device (D86); a status changed since it was followed is marked.
function FollowButton({
  entry,
  follows,
  onToggle,
}: {
  readonly entry: FeedEntry;
  readonly follows: Followed;
  readonly onToggle: (next: Followed) => void;
}) {
  const t = useText();
  const on = follows[entry.id] !== undefined;
  return (
    <button
      type="button"
      aria-pressed={on}
      title={t("feed.follow.hint")}
      onClick={() => onToggle(toggleFollow(entry.id, entry.status))}
      className={buttonStyles({ variant: "secondary", size: "min", className: "px-3" })}
    >
      <Icon name={on ? "check" : "plus"} className="size-4" />
      {on ? t("feed.follow.on") : t("feed.follow.off")}
    </button>
  );
}

// One event's card; on the list it leads to its own page with the residents' news (row 30).
export function FeedCard({
  entry,
  follow,
  commentsLink = true,
}: {
  readonly entry: FeedEntry;
  readonly follow: { readonly follows: Followed; readonly onToggle: (next: Followed) => void } | null;
  readonly commentsLink?: boolean;
}) {
  const t = useText();
  const changed =
    follow !== null && follow.follows[entry.id] !== undefined && follow.follows[entry.id] !== entry.status;
  const hazard = t(hazardKey(entry.hazardType));
  const subtype = entry.hazardSubtype ? t(`hazardSubtype.${entry.hazardType}.${entry.hazardSubtype}.label`) : null;
  return (
    <li>
      <article
        id={`feed-${entry.id}`}
        tabIndex={-1}
        aria-labelledby={`feed-${entry.id}-title`}
        className="flex flex-col gap-3 card-surface p-4 outline-offset-2 md:p-5"
      >
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-sunken text-primary">
            <Icon name={hazardIcon(entry.hazardType)} />
          </span>
          {/* The status moves under the name where both do not fit beside the icon. */}
          <div className="flex min-w-48 flex-1 flex-col gap-0.5">
            <h3 id={`feed-${entry.id}-title`} className="text-body font-bold">
              {hazard}
              {subtype ? <span className="font-normal text-muted">, {subtype}</span> : null}
            </h3>
            <p className="text-meta text-muted">
              {t("feed.place", {
                village: entry.place.villageName,
                district: entry.place.districtName,
                regency: entry.place.regencyName,
                province: entry.place.provinceName,
              })}
            </p>
          </div>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface px-2 py-0.5 text-meta font-semibold">
              <StatusDot status={entry.status} />
              {t(`feed.status.${entry.status}`)}
            </span>
            {changed ? (
              <span className="rounded-chip bg-warn-tint px-2 py-0.5 text-meta font-semibold">
                {t("feed.follow.changed")}
              </span>
            ) : null}
          </span>
        </div>
        <Impact impact={entry.impact} />
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-muted">
          {entry.eventTime ? <span>{t("feed.event", { when: eventShort(t, entry.eventTime) })}</span> : null}
          <span>{t("feed.sent", { when: whenShort(t, entry.sentAt) })}</span>
        </p>
        {entry.reporters ? (
          <p className="inline-flex items-center gap-2 text-meta font-semibold">
            <Icon name="users" className="size-4 text-muted" />
            {t("feed.reporters", { count: entry.reporters })}
          </p>
        ) : null}
        {entry.proofs.length > 0 ? (
          <figure className="flex flex-col gap-2">
            <figcaption className="text-meta text-muted">{t("feed.proofs.title")}</figcaption>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {entry.proofs.map((proofId, index) => (
                <img
                  key={proofId}
                  src={`/api/feed/proofs/${proofId}`}
                  alt={t("feed.proofs.alt", { n: index + 1, hazard, village: entry.place.villageName })}
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-control bg-sunken object-cover"
                />
              ))}
            </div>
          </figure>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {follow === null ? null : <FollowButton entry={entry} follows={follow.follows} onToggle={follow.onToggle} />}
          {commentsLink ? (
            <Link
              to={`/feed/${entry.id}`}
              className={buttonStyles({ variant: "secondary", size: "min", className: "px-3 no-underline" })}
            >
              <Icon name="messageSquare" className="size-4" />
              {t("feed.comments.link")}
            </Link>
          ) : null}
        </div>
      </article>
    </li>
  );
}

function Empty({ hazard }: { readonly hazard: string | null }) {
  const t = useText();
  return (
    <section aria-labelledby="feed-empty" className="flex flex-col items-start gap-3 card-surface p-5 md:p-7">
      <h2 id="feed-empty" className="text-section font-bold tracking-[-0.015em]">
        {hazard === null ? t("feed.empty.title") : t("feed.empty.filtered", { hazard: hazardKey(hazard) })}
      </h2>
      <p className="text-body text-muted">{t("feed.empty.lead")}</p>
      <div className="flex flex-wrap gap-3">
        {hazard === null ? null : (
          <Link to="/feed" className={buttonStyles({ variant: "secondary" })}>
            {t("feed.empty.all")}
          </Link>
        )}
        <Link to="/report" className={buttonStyles({ variant: "primary" })}>
          {t("feed.report")}
        </Link>
      </div>
    </section>
  );
}

// Why the feed could not be read: too many opens from this network, or the service.
function Unavailable({ envelope }: { readonly envelope: ErrorEnvelope | null }) {
  const t = useText();
  const limited = envelope !== null && isLimit(envelope) ? limitText(t, envelope, Date.now()) : null;
  return (
    <section aria-labelledby="feed-unavailable" className="flex flex-col items-start gap-3 card-surface p-5 md:p-7">
      <h2 id="feed-unavailable" className="text-section font-bold tracking-[-0.015em]">
        {t("feed.unavailable.title")}
      </h2>
      <p className="text-body text-muted">{limited ?? t("feed.unavailable.lead")}</p>
      <a href="/feed" className={buttonStyles({ variant: "secondary" })}>
        {t("feed.unavailable.retry")}
      </a>
    </section>
  );
}

const MODES = [
  { id: "events", to: "/feed", icon: "map" },
  { id: "watch", to: "/feed?mode=peringatan", icon: "bell" },
] as const;

// The Alun-alun's title, Sigap, and its two views (upstream DP-11): what is happening, and what is
// on watch.
export function FeedHeader({ mode }: { readonly mode: "events" | "watch" }) {
  const t = useText();
  return (
    <header className="flex flex-col gap-4">
      <div className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-2">
          <h1 className="text-page font-bold tracking-[-0.01em]">{t("feed.title")}</h1>
          <p className="max-w-[65ch] text-body text-muted">{t(mode === "events" ? "feed.lead" : "watch.lead")}</p>
        </div>
        <SigapSays
          key={mode}
          scene={mode === "events" ? "info" : "warning"}
          title={t(mode === "events" ? "sigap.feed.title" : "sigap.watch.title")}
          text={t(mode === "events" ? "sigap.feed.text" : "sigap.watch.text")}
        />
      </div>
      <nav aria-label={t("feed.mode.label")} className="flex gap-2">
        {MODES.map(({ id, to, icon }) => (
          <Link
            key={id}
            to={to}
            aria-current={id === mode ? "page" : undefined}
            className={cn(
              "inline-flex min-h-target-min items-center gap-2 rounded-full border px-4 font-semibold no-underline",
              id === mode
                ? "border-primary bg-primary text-on-primary"
                : "border-line bg-surface text-ink hover:border-primary",
            )}
          >
            <Icon name={icon} className="size-4" />
            {t(`feed.mode.${id}`)}
          </Link>
        ))}
      </nav>
    </header>
  );
}

// The map's province rings: the handled reports shown, and BNPB's events whose province we know.
export function ringsOf(entries: readonly FeedEntry[], official: Official | null) {
  return provinceRings([
    ...entries.map((entry) => ({
      provinceName: entry.place.provinceName,
      hazardType: entry.hazardType,
      point: entry.centre,
    })),
    ...(official?.events ?? []).flatMap((event) =>
      event.provinceName === null
        ? []
        : [{ provinceName: event.provinceName, hazardType: event.hazardType, point: event.point }],
    ),
  ]);
}

export type FeedLoad =
  | { readonly kind: "feed"; readonly feed: Feed }
  | { readonly kind: "unavailable"; readonly envelope: ErrorEnvelope | null };

export function FeedScreen({
  load,
  hazard,
  period = "all",
  official = null,
}: {
  readonly load: FeedLoad;
  readonly hazard: string | null;
  readonly period?: FeedPeriod;
  // BNPB's daily report with its news (row 26); null when it could not be read.
  readonly official?: Official | null;
}) {
  const t = useText();
  const all = load.kind === "feed" ? load.feed.entries : [];
  // Read once the page runs in the browser: the server knows nothing of what this device follows.
  const [follows, setFollows] = useState<Followed | null>(null);
  const [onlyFollowed, setOnlyFollowed] = useState(false);
  useEffect(() => setFollows(followed()), []);
  const mine = follows === null ? [] : all.filter((entry) => follows[entry.id] !== undefined);
  const entries = onlyFollowed && mine.length > 0 ? mine : all;
  const follow = follows === null ? null : { follows, onToggle: setFollows };
  return (
    <div className="flex flex-col gap-6">
      <FeedHeader mode="events" />
      <Filters hazard={hazard} period={period} />
      {mine.length > 0 ? (
        <button
          type="button"
          aria-pressed={onlyFollowed}
          onClick={() => setOnlyFollowed(!onlyFollowed)}
          className={buttonStyles({ variant: "secondary", size: "min", className: "px-3" })}
        >
          <Icon name="check" className="size-4" />
          {t("feed.follow.only", { count: mine.length })}
        </button>
      ) : null}
      {load.kind === "unavailable" ? (
        <Unavailable envelope={load.envelope} />
      ) : entries.length === 0 ? (
        <Empty hazard={hazard} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div
            className={cn(
              "relative h-72 overflow-hidden rounded-card border border-line md:h-96",
              "lg:sticky lg:top-6 lg:order-2 lg:h-[calc(100dvh-8rem)]",
            )}
          >
            <FeedMap markers={feedMarkers(entries, t)} rings={ringsOf(entries, official)} />
          </div>
          <section aria-labelledby="feed-count" className="flex min-w-0 flex-col gap-3 lg:order-1">
            <h2 id="feed-count" className="text-meta font-semibold text-muted">
              {t("feed.count", { count: entries.length })}
            </h2>
            <ul className="flex flex-col gap-3">
              {entries.map((entry) => (
                <FeedCard key={entry.id} entry={entry} follow={follow} />
              ))}
            </ul>
          </section>
        </div>
      )}
      <OfficialEvents official={official} entries={all} hazard={hazard} />
    </div>
  );
}
