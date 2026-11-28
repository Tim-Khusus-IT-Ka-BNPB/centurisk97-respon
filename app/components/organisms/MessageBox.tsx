import { Form } from "react-router";
import { isLimit, problemOf } from "../../lib/envelope";
import { useBusy, useWaitingUntil } from "../../lib/hooks";
import { useText } from "../../lib/text";
import { postedValue } from "../../lib/turnForm";
import { Button } from "../atoms/Button";
import { Textarea } from "../atoms/controls";
import { Icon } from "../atoms/Icon";
import { Field } from "../molecules/Field";
import { useDraftView } from "./cards/CardShell";
import { useCharCount } from "./cards/FormCards";

const MESSAGE_MAX = 2000;
// The count shows once it is worth watching.
const COUNT_FROM = 1600;

// Free text, docked under the live card. After a refusal the typed text stays; after a limit,
// sending waits for the retry time while typing goes on.
export function MessageBox() {
  const t = useText();
  const { draft, turnKey, envelope, posted } = useDraftView();
  const text = postedValue(posted, "text", null);
  const count = useCharCount(text);
  const busy = useBusy("message");
  const retryAt = envelope?.retryAt ? Date.parse(envelope.retryAt.utc) : null;
  const waiting = useWaitingUntil(retryAt);
  const problem = problemOf(envelope, "text");
  return (
    <div className="dock z-10 -mx-4 mt-auto border-t border-line bg-surface pb-[max(0.75rem,env(safe-area-inset-bottom))] md:-mx-6 lg:mx-0 lg:mb-6 lg:rounded-card lg:border lg:pb-3">
      <Form method="post" replace preventScrollReset className="flex flex-col gap-1 px-4 pt-3 md:px-6 lg:px-4">
        <input type="hidden" name="action" value="turn" />
        <input type="hidden" name="kind" value="freeText" />
        <input type="hidden" name="revision" value={draft.revision} />
        <input type="hidden" name="turnKey" value={turnKey} />
        <Field
          id="text"
          label={t("chat.box.label")}
          hint={draft.freeTextAllowed ? null : t("chat.box.useCard")}
          problem={problem}
          focus={problem !== null || isLimit(envelope)}
          labelHidden
          className="flex min-w-0 flex-col gap-1"
        >
          {(control) => (
            <div className="flex flex-wrap items-end gap-2">
              <Textarea
                {...control}
                rows={1}
                defaultValue={text}
                onInput={count.onInput}
                // Before the reporter has said anything, the box asks for the story itself.
                placeholder={t(
                  draft.transcript.some((line) => line.speaker === "reporter")
                    ? "chat.box.placeholder"
                    : "chat.box.story",
                )}
                className="grow-box min-w-[min(100%,12rem)] flex-1 resize-none"
              />
              <Button
                name="intent"
                value="message"
                variant="primary"
                aria-label={t("chat.box.send")}
                aria-disabled={waiting ? true : undefined}
                onClick={(event) => waiting && event.preventDefault()}
                busyLabel={busy ? t("chat.box.sending") : null}
                className="min-w-target shrink-0 px-3"
              >
                <Icon name="send" />
              </Button>
            </div>
          )}
        </Field>
        {count.length < COUNT_FROM ? null : (
          <p className="text-meta text-muted tabular-nums">
            {t("common.charCount", { length: count.length, max: MESSAGE_MAX })}
          </p>
        )}
      </Form>
    </div>
  );
}
