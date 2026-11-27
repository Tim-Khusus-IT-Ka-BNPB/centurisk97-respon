import { data, Link, redirect } from "react-router";
import type { Comments } from "../../src/contract/comments";
import type { MeResponse } from "../../src/contract/draft";
import type { ErrorEnvelope } from "../../src/contract/errors";
import type { Feed } from "../../src/contract/publicFeed";
import { buttonStyles } from "../components/atoms/Button";
import { Icon } from "../components/atoms/Icon";
import { CardComments } from "../components/organisms/CardComments";
import { FeedCard } from "../components/organisms/FeedScreen";
import { Page } from "../components/templates/Page";
import { pageMeta } from "../lib/meta";
import { useText } from "../lib/text";
import { languageOf, PAGE_TEXTS, pickTexts } from "../lib/texts.server";
import type { Route } from "./+types/feedCard";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.feedCard.title",
    description: "meta.feedCard.description",
    path: `/lapor/feed/${args.params.cardId}`,
    index: false,
  });

// One card of the Alun-alun with the residents' news on it (row 30), read on the server. A card no
// longer shown answers 404.
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const texts = pickTexts(PAGE_TEXTS.feedCard, null, languageOf(request));
  const search = new URL(request.url).searchParams;
  const done = search.has("terkirim") ? ("sent" as const) : search.has("dilaporkan") ? ("reported" as const) : null;
  const [feed, comments, me] = await Promise.all([
    context.api("GET", "/feed"),
    context.api("GET", `/feed/cards/${encodeURIComponent(params.cardId)}/comments`),
    context.api("GET", "/me"),
  ]);
  const entry = feed.ok
    ? (((await feed.json()) as Feed).entries.find((one) => one.id === params.cardId) ?? null)
    : null;
  if (entry === null || !comments.ok) return data({ kind: "gone" as const, texts }, { status: 404 });
  const known = me.ok ? ((await me.json()) as MeResponse).knownReporters.length > 0 : false;
  return { kind: "card" as const, entry, comments: ((await comments.json()) as Comments).comments, known, done, texts };
}

// A comment written, or one reported; either is answered on the page after.
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const card = encodeURIComponent(params.cardId);
  const commenting = form.get("intent") === "comment";
  const text = String(form.get("text") ?? "");
  const response = commenting
    ? await context.api("POST", `/feed/cards/${card}/comments`, { text })
    : await context.api("POST", `/feed/comments/${encodeURIComponent(String(form.get("commentId") ?? ""))}/report`);
  if (response.ok) return redirect(`/lapor/feed/${card}?${commenting ? "terkirim" : "dilaporkan"}=1#kabar`, 303);
  const envelope = (await response.json()) as ErrorEnvelope;
  return data({ envelope, typed: commenting ? text : "" }, { status: response.status });
}

function Gone() {
  const t = useText();
  return (
    <section className="flex flex-col items-start gap-3 card-surface p-5">
      <h2 className="text-section font-bold">{t("feed.card.gone")}</h2>
      <Link to="/lapor/feed" className={buttonStyles({ variant: "secondary" })}>
        {t("feed.card.back")}
      </Link>
    </section>
  );
}

function Back() {
  const t = useText();
  return (
    <Link to="/lapor/feed" className="inline-flex items-center gap-1.5 self-start font-semibold text-primary">
      <Icon name="arrowLeft" className="size-4" />
      {t("feed.card.back")}
    </Link>
  );
}

export default function FeedCardRoute({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <Page texts={loaderData.texts} banner={{ title: "feed.comments.title", lead: "feed.card.lead" }}>
      {loaderData.kind === "gone" ? (
        <Gone />
      ) : (
        <div className="flex flex-col gap-5">
          <Back />
          <ul>
            <FeedCard entry={loaderData.entry} follow={null} commentsLink={false} />
          </ul>
          <CardComments
            comments={loaderData.comments}
            mayComment={loaderData.known}
            envelope={actionData?.envelope ?? null}
            typed={actionData?.typed ?? ""}
            done={actionData ? null : loaderData.done}
          />
        </div>
      )}
    </Page>
  );
}
