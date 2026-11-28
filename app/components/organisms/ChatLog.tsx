import type { DraftBody } from "../../../src/contract/draft";
import type { Text } from "../../../src/copy/text";
import { cn } from "../../lib/cn";
import { factText, parseFacts } from "../../lib/noted";
import { breakAfterSlash } from "../../lib/slash";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";

type Entry = DraftBody["transcript"][number];

// Lines carry no id; their time and speaker name them, counted when two share both.
export function lineKeys(transcript: readonly Entry[]): readonly string[] {
  const seen = new Map<string, number>();
  return transcript.map((entry) => {
    const base = `${entry.at.utc}:${entry.speaker}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return `${base}:${count}`;
  });
}

// A question line: its question when it has one (a guided step's line is stored by its progress
// heading), else its heading, both with the line's params.
function questionText(t: Text, entry: Extract<Entry, { speaker: "assistant" }>) {
  return t(entry.promptKey ?? entry.copyKey, entry.params);
}

// What Sigap read from a message, listed so the reporter can check it and correct it.
function Noted({ facts }: { readonly facts: unknown }) {
  const t = useText();
  return (
    <div className="flex flex-col gap-1.5">
      <p>{t("reply.noted")}</p>
      <ul className="flex list-disc flex-col gap-0.5 ps-5">
        {parseFacts(facts).map((fact) => (
          <li key={fact.field}>{factText(t, fact)}</li>
        ))}
      </ul>
      <p className="text-meta text-muted">{t("reply.notedHint")}</p>
    </div>
  );
}

function Lines({ entries, keys }: { readonly entries: readonly Entry[]; readonly keys: readonly string[] }) {
  const t = useText();
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((entry, index) => {
        const own = entry.speaker === "reporter";
        return (
          <li
            key={keys[index]}
            className={cn(
              "max-w-[min(85%,40rem)] rounded-[1.125rem] px-4 py-2.5 text-body",
              own
                ? "self-end rounded-ee-chip bg-primary text-on-primary [overflow-wrap:anywhere]"
                : "self-start rounded-es-chip border border-line bg-surface break-words",
            )}
          >
            {own ? (
              entry.textMasked
            ) : entry.copyKey === "reply.noted" ? (
              <Noted facts={entry.params.facts} />
            ) : (
              breakAfterSlash(questionText(t, entry))
            )}
          </li>
        );
      })}
    </ol>
  );
}

// The last question and its answer stay in view; what came before them opens on demand, so the
// live card is always near the top of the screen.
const RECENT = 2;

// The conversation so far, without the live card's own line: the card itself follows. It is a
// log by role so tools can find it, but it does not speak: the polite status speaks for new
// questions, and a resumed history stays silent.
export function ChatLog({ transcript }: { readonly transcript: readonly Entry[] }) {
  const t = useText();
  const last = transcript.at(-1);
  const shown = last?.speaker === "assistant" && last.cardKind !== null ? transcript.slice(0, -1) : transcript;
  if (shown.length === 0) return null;
  const keys = lineKeys(shown);
  const split = Math.max(0, shown.length - RECENT);
  return (
    <div role="log" aria-live="off" aria-label={t("chat.log.label")} className="flex flex-col gap-3">
      {split > 0 ? (
        <details className="group flex flex-col">
          <summary className="mx-auto flex min-h-target-min w-fit list-none items-center gap-1.5 rounded-control px-3 text-meta font-semibold text-muted hover:bg-sunken [&::-webkit-details-marker]:hidden">
            <Icon name="chevronRight" className="size-4 rotate-90 group-open:-rotate-90" />
            {t("chat.log.earlier", { count: split })}
          </summary>
          <div className="pt-2">
            <Lines entries={shown.slice(0, split)} keys={keys.slice(0, split)} />
          </div>
        </details>
      ) : null}
      <Lines entries={shown.slice(split)} keys={keys.slice(split)} />
    </div>
  );
}
