import { Form, useNavigation } from "react-router";
import type { DeskReport } from "../../../../src/contract/desk";
import { cn } from "../../../lib/cn";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Input } from "../../atoms/controls";
import { when } from "./parts";

type Comments = NonNullable<DeskReport["comments"]>;
type Item = Comments["items"][number];
type Figure = Item["figures"][number];

const STATUS_LOOK: Readonly<Record<Item["status"], string>> = {
  shown: "bg-selected text-primary",
  reported: "bg-warn-tint text-ink",
  hidden: "bg-sunken text-muted",
};
const HOUSE_LEVELS = ["housesHeavy", "housesModerate", "housesLight"] as const;

function Reason({ id }: { readonly id: string }) {
  const t = useText();
  return (
    <span className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-meta">
      <label htmlFor={id}>{t("desk.comments.reason")}</label>
      <Input id={id} name="reason" maxLength={300} />
    </span>
  );
}

// A figure read from the comment: taken into the report the card shows, or turned down (D139).
function FigureRow({ figure }: { readonly figure: Figure }) {
  const t = useText();
  const navigation = useNavigation();
  const busy = navigation.formData?.get("figureId") === String(figure.id);
  return (
    <li className="flex flex-col gap-2 rounded-control bg-sunken p-3">
      <p>
        <span className="font-semibold">
          {t(`desk.comments.figure.${figure.figure}`)}: {figure.value}
        </span>
        <span className="text-muted"> · “{figure.quote}”</span>
      </p>
      {figure.status === "proposed" ? (
        <Form method="post" replace preventScrollReset className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="action" value="figure" />
          <input type="hidden" name="figureId" value={figure.id} />
          {figure.figure === "houses" ? (
            <span className="flex flex-col gap-1 text-meta">
              <label htmlFor={`field-${figure.id}`}>{t("desk.comments.housesLevel")}</label>
              <select
                id={`field-${figure.id}`}
                name="field"
                className="min-h-target-min rounded-control border border-control bg-surface px-2"
              >
                {HOUSE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`field.${level}.label`)}
                  </option>
                ))}
              </select>
            </span>
          ) : null}
          <Reason id={`reason-figure-${figure.id}`} />
          <Button
            variant="primary"
            size="min"
            name="accept"
            value="1"
            busyLabel={busy ? t("desk.comments.busy") : null}
          >
            {t("desk.comments.accept")}
          </Button>
          <Button variant="secondary" size="min" name="accept" value="0">
            {t("desk.comments.reject")}
          </Button>
        </Form>
      ) : (
        <p className="text-meta text-muted">{t(`desk.comments.figureStatus.${figure.status}`)}</p>
      )}
    </li>
  );
}

function CommentItem({ item }: { readonly item: Item }) {
  const t = useText();
  const navigation = useNavigation();
  const busy = navigation.formData?.get("commentId") === item.id;
  const shown = item.status !== "hidden";
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap items-center gap-2 text-meta">
        <span className={cn("rounded-chip px-2 py-0.5 font-semibold", STATUS_LOOK[item.status])}>
          {t(`desk.comments.status.${item.status}`)}
        </span>
        <span className="text-muted tabular-nums">{when(t, "desk.history.at", item.at)}</span>
        {item.reports > 0 ? <span>{t("desk.comments.reports", { count: item.reports })}</span> : null}
        {item.authorHidden > 0 ? (
          <span className="text-danger">{t("desk.comments.authorHidden", { count: item.authorHidden })}</span>
        ) : null}
      </p>
      <p className="whitespace-pre-line break-words">{item.text}</p>
      {item.figures.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label={t("desk.comments.figures")}>
          {item.figures.map((figure) => (
            <FigureRow key={figure.id} figure={figure} />
          ))}
        </ul>
      ) : null}
      <Form method="post" replace preventScrollReset className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="action" value="commentShown" />
        <input type="hidden" name="commentId" value={item.id} />
        <input type="hidden" name="shown" value={shown ? "0" : "1"} />
        <Reason id={`reason-comment-${item.id}`} />
        <Button variant={shown ? "danger" : "secondary"} size="min" busyLabel={busy ? t("desk.comments.busy") : null}>
          {t(shown ? "desk.comments.hide" : "desk.comments.show")}
        </Button>
      </Form>
      {item.decisions.length > 0 ? (
        <ol className="flex flex-col gap-0.5 text-meta text-muted">
          {item.decisions.map((decision) => (
            <li key={`${decision.action}-${decision.at.utc}`}>
              {t(`desk.comments.decided.${decision.action}`, { by: decision.by })},{" "}
              {when(t, "desk.history.at", decision.at)}
              {decision.reason ? `: ${decision.reason}` : ""}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

// The residents' news on the Alun-alun card this report shows on (upstream LA-88): reported ones
// first need a look; a figure is taken into the report only here.
export function DeskComments({ comments }: { readonly comments: Comments }) {
  const t = useText();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta text-muted">{t("desk.comments.hint")}</p>
      <ol className="flex flex-col">
        {comments.items.map((item) => (
          <CommentItem key={item.id} item={item} />
        ))}
      </ol>
    </div>
  );
}
