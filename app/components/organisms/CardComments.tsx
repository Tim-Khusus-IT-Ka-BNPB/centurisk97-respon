import { Form, Link, useNavigation } from "react-router";
import type { Comments } from "../../../src/contract/comments";
import type { ErrorEnvelope } from "../../../src/contract/errors";
import { COMMENT_MAX } from "../../../src/domain/comments";
import { isLimit, problemOf } from "../../lib/envelope";
import { limitText } from "../../lib/status";
import { useText } from "../../lib/text";
import { Button, buttonStyles } from "../atoms/Button";
import { Textarea } from "../atoms/controls";
import { Icon } from "../atoms/Icon";
import { Field } from "../molecules/Field";
import { Notice } from "../molecules/Notice";
import { whenShort } from "./desk/parts";

// What the page was told after a post: a refusal not of the text box, or what was just done.
function Told({
  envelope,
  done,
}: {
  readonly envelope: ErrorEnvelope | null;
  readonly done: "sent" | "reported" | null;
}) {
  const t = useText();
  if (envelope !== null && problemOf(envelope, "text") === null)
    return (
      <Notice kind="error">
        {isLimit(envelope) ? limitText(t, envelope, Date.now()) : t(envelope.error.copyKey, envelope.error.params)}
      </Notice>
    );
  if (done === null) return null;
  return (
    <p role="status" className="font-semibold text-primary">
      {t(done === "sent" ? "feed.comments.sent" : "feed.comments.reported")}
    </p>
  );
}

// The residents' news on one card (upstream lapor_komen, row 30): shown as "Warga" with the minute,
// each one reportable; written by a reporter known on this phone. Works with no script.
export function CardComments({
  comments,
  mayComment,
  envelope,
  typed,
  done,
}: {
  readonly comments: Comments["comments"];
  readonly mayComment: boolean;
  readonly envelope: ErrorEnvelope | null;
  readonly typed: string;
  readonly done: "sent" | "reported" | null;
}) {
  const t = useText();
  const navigation = useNavigation();
  const posting = navigation.formData?.get("intent");
  return (
    <section aria-labelledby="comments-title" id="news" className="flex flex-col gap-4 card-surface p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="comments-title" className="text-card font-bold">
          {t("feed.comments.title")}
        </h2>
        <p className="max-w-[65ch] text-meta text-muted">{t("feed.comments.lead")}</p>
      </div>
      <Told envelope={envelope} done={done} />
      {comments.length === 0 ? (
        <p className="text-muted">{t("feed.comments.none")}</p>
      ) : (
        <ol className="flex flex-col">
          {comments.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0 first:pt-0">
              <p className="flex flex-wrap items-baseline gap-x-2 text-meta">
                <span className="font-semibold">{t("feed.comments.author")}</span>
                <span className="text-muted tabular-nums">{whenShort(t, comment.at)}</span>
              </p>
              <p className="whitespace-pre-line break-words">{comment.text}</p>
              {mayComment ? (
                <Form method="post" replace preventScrollReset className="self-end">
                  <input type="hidden" name="intent" value="report" />
                  <input type="hidden" name="commentId" value={comment.id} />
                  <Button
                    variant="quiet"
                    size="min"
                    aria-label={t("feed.comments.reportLabel")}
                    busyLabel={
                      posting === "report" && navigation.formData?.get("commentId") === comment.id
                        ? t("feed.comments.sending")
                        : null
                    }
                  >
                    <Icon name="triangleAlert" className="size-4" />
                    {t("feed.comments.report")}
                  </Button>
                </Form>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {mayComment ? (
        <Form method="post" preventScrollReset className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="comment" />
          <Field
            id="text"
            label={t("feed.comments.field")}
            hint={t("feed.comments.hint")}
            problem={problemOf(envelope, "text")}
          >
            {(control) => (
              // A kept comment is a new one on the list: the box starts empty again.
              <Textarea
                key={comments.length}
                {...control}
                defaultValue={typed}
                maxLength={COMMENT_MAX}
                rows={3}
                required
              />
            )}
          </Field>
          <Button
            variant="primary"
            className="self-start"
            busyLabel={posting === "comment" ? t("feed.comments.sending") : null}
          >
            {t("feed.comments.send")}
          </Button>
        </Form>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-control bg-sunken p-4">
          <p>{t("feed.comments.knownFirst")}</p>
          <Link to="/report" className={buttonStyles({ variant: "secondary" })}>
            {t("feed.comments.reportFirst")}
          </Link>
        </div>
      )}
    </section>
  );
}
