import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { Card } from "../../../../src/contract/card";
import type { Tracking } from "../../../../src/contract/tracking";
import { qrModules, qrPath } from "../../../../src/domain/qr";
import { problemOf } from "../../../lib/envelope";
import { useBusy, useHydrated, useMountFocus } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { buttonStyles } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";
import { FieldError } from "../../molecules/Field";
import { ActionRow } from "../../molecules/layout";
import { NationalNumbers, NearestNumbers } from "../../molecules/NationalNumbers";
import { headingIdOf, useDraftView } from "./CardShell";

type SentCardData = Extract<Card, { kind: "sent" }>;

export const trackingPath = (token: string) => `/track#t=${token}`;

// The five handling stages as a strip: done ones filled and named, the rest waiting.
function StageStrip({ stages }: { readonly stages: Tracking["stages"] }) {
  const t = useText();
  return (
    // A row of five where the card is wide enough for "Ditindaklanjuti" whole, else a list.
    <ol className="grid grid-cols-1 gap-2 text-meta @tiles:grid-cols-5 @tiles:gap-1 @tiles:text-center">
      {stages.map((stage) => {
        const done = stage.reachedAt !== null;
        return (
          <li key={stage.status} className="flex min-w-0 items-center gap-2 @tiles:flex-col @tiles:gap-1">
            <span
              aria-hidden="true"
              className={`flex size-7 items-center justify-center rounded-full border-2 ${
                done ? "border-primary bg-primary text-on-primary" : "border-control bg-surface text-muted"
              }`}
            >
              {done ? <Icon name="check" className="size-4" /> : null}
            </span>
            <span className={done ? "font-semibold" : "text-muted"}>
              {t(`stage.short.${stage.status}`)}
              <span className="sr-only">{done ? "" : `, ${t("stage.waiting")}`}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Who to call about the report: its regency's or province's BPBD, or BNPB's 117 when neither has
// a number recorded (K88). A number is never made up.
export function ContactBlock({ contact }: { readonly contact: Tracking["contact"] }) {
  const t = useText();
  const phone = contact.level === "national" ? "117" : contact.phone;
  return (
    <section
      aria-labelledby="bpbd-contact"
      className="@container flex flex-col items-start gap-2 rounded-control bg-sunken p-4"
    >
      <h3 id="bpbd-contact" className="font-bold">
        {t("card.sent.contact.title")}
      </h3>
      <p className="break-words">
        {contact.level === "national"
          ? t("card.sent.contact.national")
          : t(`card.sent.contact.${contact.level}`, { name: contact.name })}
      </p>
      {contact.level === "national" ? <p className="text-meta text-muted">{t("card.sent.contact.missing")}</p> : null}
      <a
        href={`tel:${phone.replace(/[^\d+]/g, "")}`}
        className={buttonStyles({ variant: "signal", size: "main", className: "w-full @tiles:w-auto" })}
      >
        <Icon name="phone" />
        {t("card.sent.contact.call", { phone })}
      </a>
    </section>
  );
}

export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  const modules = qrModules(text);
  const size = modules.length + 8;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="aspect-square h-auto w-40 max-w-full rounded-control border border-line bg-white"
    >
      <path d={qrPath(modules)} fill="#000" />
    </svg>
  );
}

// Copies its text once the page runs script; with none there is nothing to press.
function CopyButton({
  text,
  label,
  idle,
  done,
}: {
  readonly text: string;
  readonly label: string;
  readonly idle: string;
  readonly done: string;
}) {
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);
  if (!hydrated) return null;
  return (
    <button
      type="button"
      aria-label={label}
      className={buttonStyles({ variant: "secondary", size: "min" })}
      onClick={async () => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        setCopied(true);
      }}
    >
      <Icon name={copied ? "check" : "copy"} className="size-5" />
      {copied ? done : idle}
    </button>
  );
}

// The tracking link whole, to select or copy: on another phone it is the only way back to the report.
export function TrackingLinkText({ url, ticketNumber }: { readonly url: string; readonly ticketNumber: string }) {
  const t = useText();
  return (
    <div className="flex w-full flex-col items-start gap-2">
      <p
        data-testid="tracking-link"
        className="w-full rounded-control border border-line bg-surface px-3 py-2 font-mono text-meta break-all select-all"
      >
        {url}
      </p>
      <CopyButton
        text={url}
        label={t("card.sent.link.copyLabel", { ticketNumber })}
        idle={t("card.sent.link.copy")}
        done={t("card.sent.link.copied")}
      />
    </div>
  );
}

// Right after "Kirim" (K81): thanks by name with the ticket number; a tap anywhere asks for a
// rating, and a rating closes it. It shows until the report is rated. Links and a form, so it
// works with no script.
function ThankYou({ card }: { readonly card: SentCardData }) {
  const t = useText();
  const { turnKey, envelope } = useDraftView();
  const [search] = useSearchParams();
  const rating = search.has("rate");
  const heading = useMountFocus<HTMLHeadingElement>(true);
  const problem = problemOf(envelope, "rating");
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="thanks-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto contours p-4 text-on-hero"
    >
      {rating ? (
        <Form
          method="post"
          replace
          preventScrollReset
          className="flex w-full max-w-md flex-col items-center gap-5 text-center"
        >
          <input type="hidden" name="action" value="rate" />
          <input type="hidden" name="ticketNumber" value={card.ticketNumber} />
          <input type="hidden" name="turnKey" value={turnKey} />
          <h2 id="thanks-title" ref={heading} tabIndex={-1} className="text-card font-bold text-balance">
            {t("card.sent.rate.question")}
          </h2>
          <div className="grid w-full grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <RateButton key={n} n={n} />
            ))}
          </div>
          <p className="flex w-full justify-between text-meta">
            <span>{t("card.sent.rate.low")}</span>
            <span>{t("card.sent.rate.high")}</span>
          </p>
          <FieldError id="rating" problem={problem} />
        </Form>
      ) : (
        <Link
          to="?rate"
          replace
          preventScrollReset
          className="flex min-h-full w-full max-w-md flex-col items-center justify-center gap-4 text-center no-underline"
        >
          <span className="flex size-20 items-center justify-center rounded-full bg-accent text-on-accent">
            <Icon name="check" className="size-10" />
          </span>
          <span className="pt-2 text-on-hero-muted">{t("card.sent.thanks.label")}</span>
          <h2 id="thanks-title" ref={heading} tabIndex={-1} className="text-display font-bold text-balance">
            {t("card.sent.thanks.title", { firstName: card.firstName })}
          </h2>
          <span className="my-2 flex w-full max-w-xs flex-col gap-1 rounded-card border border-on-hero-muted/30 bg-on-hero/6 px-6 py-4">
            <span className="text-on-hero-muted">{t("card.sent.thanks.ticket")}</span>
            <span className="text-ticket font-bold tabular-nums">{card.ticketNumber}</span>
          </span>
          <span className="max-w-[34ch] text-balance text-on-hero-muted">{t("card.sent.contactPromise")}</span>
          <span className={buttonStyles({ variant: "onHero", className: "mt-4" })}>{t("card.sent.thanks.next")}</span>
        </Link>
      )}
    </div>
  );
}

function RateButton({ n }: { readonly n: number }) {
  const t = useText();
  const busy = useBusy(String(n), "rating");
  return (
    <button
      type="submit"
      name="rating"
      value={n}
      aria-label={t("card.sent.rate.choice", { n })}
      aria-disabled={busy ? true : undefined}
      onClick={(event) => busy && event.preventDefault()}
      className="flex min-h-target-main min-w-0 items-center justify-center rounded-control border-2 border-on-hero-muted/60 text-card font-bold tabular-nums hover:bg-on-hero/12"
    >
      {n}
    </button>
  );
}

// The ticket card (K18, K88): the number to keep, the tracking link to keep and its QR code, the
// stages, who to call, and a new report. It promises only what is done now: received, tracked, and
// contact by staff, who see the report and its number on the desk.
export function TicketCard({ card }: { readonly card: SentCardData }) {
  const t = useText();
  const { origin } = useDraftView();
  const heading = useMountFocus<HTMLHeadingElement>(card.rating !== null);
  const link = trackingPath(card.trackingToken);
  const url = `${origin}${link}`;
  return (
    <>
      {card.rating === null ? <ThankYou card={card} /> : null}
      <section
        aria-labelledby={headingIdOf(card)}
        data-card-kind={card.kind}
        data-card-id={card.cardId}
        className="@container flex animate-settle flex-col gap-6 card-surface p-4 md:p-6"
      >
        {/* Wide: the ticket and what to do on the left, the QR and who to call on the right. */}
        <div className="grid gap-6 @split:grid-cols-[minmax(0,1fr)_16rem] @split:gap-8">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-3 @tiles:flex-row @tiles:items-start @tiles:gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-selected text-primary">
                <Icon name="check" className="size-6" />
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id={headingIdOf(card)} ref={heading} tabIndex={-1} className="text-page font-bold text-balance">
                  {t("card.sent.heading")}
                </h2>
                <p className="text-muted">{t("card.sent.contactPromise")}</p>
              </div>
            </div>
            <div className="flex flex-col gap-1 rounded-control bg-sunken px-4 py-3">
              <span className="text-meta text-muted">{t("card.sent.number")}</span>
              <p className="flex flex-wrap items-center gap-3">
                <span data-testid="ticket-number" className="text-ticket font-bold whitespace-nowrap tabular-nums">
                  {card.ticketNumber}
                </span>
                <CopyButton
                  text={card.ticketNumber}
                  label={t("card.sent.copyLabel", { ticketNumber: card.ticketNumber })}
                  idle={t("card.sent.copy")}
                  done={t("card.sent.copied")}
                />
              </p>
            </div>
            <section
              aria-labelledby="sent-link"
              className="flex flex-col items-start gap-2 rounded-control border-2 border-primary bg-selected px-4 py-3"
            >
              <h3 id="sent-link" className="flex items-center gap-2 font-bold">
                <Icon name="link" className="size-5 text-primary" />
                {t("card.sent.link.title")}
              </h3>
              <p className="text-meta">{t("card.sent.link.keep")}</p>
              <TrackingLinkText url={url} ticketNumber={card.ticketNumber} />
            </section>
            <section aria-label={t("card.sent.stages")}>
              {card.tracking.rejected === null ? (
                <StageStrip stages={card.tracking.stages} />
              ) : (
                <p className="flex items-start gap-2">
                  <Icon name="circleX" className="mt-0.5 text-danger" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{t("stage.long.invalid")}</span>
                    <span className="break-words">
                      {t("tracking.rejected", { reason: card.tracking.rejected.reason })}
                    </span>
                  </span>
                </p>
              )}
            </section>
            <ActionRow>
              <Link
                to={`/reports/${card.ticketNumber}`}
                className={buttonStyles({ variant: "primary", size: "main", className: "@actions:flex-1" })}
              >
                {t("card.sent.open")}
              </Link>
              <a
                href={link}
                className={buttonStyles({ variant: "secondary", size: "main", className: "@actions:px-6" })}
              >
                {t("card.sent.track")}
              </a>
            </ActionRow>
          </div>
          <div className="flex min-w-0 flex-col gap-4 @split:border-s @split:border-line @split:ps-8">
            <figure className="flex flex-col items-start gap-2">
              <QrCode text={url} label={t("card.sent.qr", { ticketNumber: card.ticketNumber })} />
              <figcaption className="text-meta text-muted">{t("card.sent.qrHint")}</figcaption>
            </figure>
            <ContactBlock contact={card.tracking.contact} />
          </div>
        </div>
        <div className="flex flex-col gap-6 border-t border-line pt-4">
          <NationalNumbers />
          <NearestNumbers nearest={card.nearest} />
        </div>
        <div className="flex flex-col border-t border-line pt-4 @actions:items-start">
          <Link to="/report" className={buttonStyles({ variant: "secondary", size: "main" })}>
            <Icon name="plus" />
            {t("card.sent.new")}
          </Link>
        </div>
      </section>
    </>
  );
}
