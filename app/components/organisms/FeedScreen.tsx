import { Link } from "react-router";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import type { Feed, FeedEntry } from "../../../src/contract/publicFeed";
import { hazardKey } from "../../../src/copy/hazardKey";
import { SELECTABLE_HAZARD_TYPES } from "../../../src/domain/hazards";
import { cn } from "../../lib/cn";
import { isLimit } from "../../lib/envelope";
import { hazardIcon } from "../../lib/hazardIcons";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { eventShort, Impact, StatusDot, whenShort } from "./desk/parts";
import { FeedMap } from "./FeedMap";

const chip =
  "inline-flex min-h-target-min shrink-0 items-center gap-2 rounded-control border border-line bg-surface px-3 text-ink no-underline transition-colors duration-100 motion-reduce:transition-none hover:border-control aria-[current=true]:border-primary aria-[current=true]:bg-selected aria-[current=true]:font-semibold aria-[current=true]:text-primary";

const feedLink = (hazard: string | null) => (hazard === null ? "/lapor/feed" : `/lapor/feed?hazard=${hazard}`);

function HazardFilter({ hazard }: { readonly hazard: string | null }) {
  const t = useText();
  return (
    <nav
      aria-label={t("feed.filter.label")}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6"
    >
      <Link to={feedLink(null)} aria-current={hazard === null ? "true" : undefined} className={chip}>
        {t("feed.filter.all")}
      </Link>
      {SELECTABLE_HAZARD_TYPES.map((id) => (
        <Link key={id} to={feedLink(id)} aria-current={hazard === id ? "true" : undefined} className={chip}>
          <Icon name={hazardIcon(id)} className="size-4" />
          {t(hazardKey(id))}
        </Link>
      ))}
    </nav>
  );
}

function FeedCard({ entry }: { readonly entry: FeedEntry }) {
  const t = useText();
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
            <h2 id={`feed-${entry.id}-title`} className="text-body font-bold">
              {hazard}
              {subtype ? <span className="font-normal text-muted">, {subtype}</span> : null}
            </h2>
            <p className="text-meta text-muted">
              {t("feed.place", {
                village: entry.place.villageName,
                district: entry.place.districtName,
                regency: entry.place.regencyName,
                province: entry.place.provinceName,
              })}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-chip border border-line bg-surface px-2 py-0.5 text-meta font-semibold">
            <StatusDot status={entry.status} />
            {t(`feed.status.${entry.status}`)}
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
              {entry.proofs.map((proofId) => (
                <img
                  key={proofId}
                  src={`/api/lapor/feed/proofs/${proofId}`}
                  alt={t("feed.proofs.alt", { hazard, village: entry.place.villageName })}
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-control bg-sunken object-cover"
                />
              ))}
            </div>
          </figure>
        ) : null}
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
          <Link to={feedLink(null)} className={buttonStyles({ variant: "secondary" })}>
            {t("feed.empty.all")}
          </Link>
        )}
        <Link to="/lapor/report" className={buttonStyles({ variant: "primary" })}>
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
      <a href="/lapor/feed" className={buttonStyles({ variant: "secondary" })}>
        {t("feed.unavailable.retry")}
      </a>
    </section>
  );
}

export type FeedLoad =
  | { readonly kind: "feed"; readonly feed: Feed }
  | { readonly kind: "unavailable"; readonly envelope: ErrorEnvelope | null };

export function FeedScreen({ load, hazard }: { readonly load: FeedLoad; readonly hazard: string | null }) {
  const t = useText();
  const entries = load.kind === "feed" ? load.feed.entries : [];
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-page font-bold tracking-[-0.01em]">{t("feed.title")}</h1>
        <p className="max-w-[65ch] text-body text-muted">{t("feed.lead")}</p>
      </header>
      <HazardFilter hazard={hazard} />
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
            <FeedMap entries={entries} />
          </div>
          <section aria-labelledby="feed-count" className="flex min-w-0 flex-col gap-3 lg:order-1">
            <h2 id="feed-count" className="text-meta font-semibold text-muted">
              {t("feed.count", { count: entries.length })}
            </h2>
            <ul className="flex flex-col gap-3">
              {entries.map((entry) => (
                <FeedCard key={entry.id} entry={entry} />
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
