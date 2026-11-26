import { data, redirect, type ShouldRevalidateFunctionArgs } from "react-router";
import { languageFrom } from "../../src/copy/languages";
import { DraftScreen, RefusedScreen } from "../components/organisms/DraftScreen";
import { Page } from "../components/templates/Page";
import { actOnDraft, loadDraftPage } from "../lib/draftPage.server";
import type { DraftActionData } from "../lib/draftTypes";
import { pageMeta } from "../lib/meta";
import { isLost, LOST, withinTimeout } from "../lib/network";
import { postedOf } from "../lib/turnForm";
import type { Route } from "./+types/draft";

export const headers = () => ({ "cache-control": "private, no-store" });

export const meta = (args: Route.MetaArgs) =>
  pageMeta(args, {
    title: "page.draft.title",
    description: "meta.draft.description",
    path: "/lapor/report",
    index: false,
  });

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const page = await loadDraftPage(
    params.draftId,
    new URL(request.url),
    context.api,
    () => crypto.randomUUID(),
    languageFrom(request.headers.get("cookie")),
  );
  const card = page.data.kind === "draft" ? page.data.draft.card : null;
  // News that is sent or dropped is told on its report's own page.
  if (card?.kind === "followUpEnded") throw redirect(`/lapor/reports/${card.ticketNumber}?saved=${card.outcome}`, 303);
  return data(page.data, { status: page.status });
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const acted = await actOnDraft(params.draftId, await request.formData(), context.api);
  if (acted.kind === "redirect") return redirect(acted.location, { status: 303, headers: acted.headers });
  return data(acted.data, { status: acted.status });
}

// With script a turn that takes over 8 s, or whose connection drops, keeps the page as it is.
export async function clientAction({ request, serverAction }: Route.ClientActionArgs): Promise<DraftActionData> {
  const posted = postedOf(await request.clone().formData());
  const answer = await withinTimeout(serverAction());
  return isLost(answer) ? { envelope: null, posted, ...LOST } : answer;
}

// A lost turn keeps this render's turn key, so the retry by hand replays instead of counting twice.
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return isLost(actionResult) ? false : defaultShouldRevalidate;
}

export default function DraftRoute({ loaderData, actionData }: Route.ComponentProps) {
  if (loaderData.kind === "refused")
    return (
      <Page texts={loaderData.texts} publicPage={false}>
        <RefusedScreen envelope={loaderData.envelope} />
      </Page>
    );
  return <DraftScreen page={loaderData} acted={actionData ?? null} />;
}
