import type { DraftBody } from "../../../src/contract/draft";
import { cn } from "../../lib/cn";
import { breakAfterSlash } from "../../lib/slash";
import { type Text, useText } from "../../lib/text";

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

// The conversation so far, without the live card's own line: the card itself follows. It is a
// log by role so tools can find it, but it does not speak: the polite status speaks for new
// questions, and a resumed history stays silent.
export function ChatLog({ transcript }: { readonly transcript: readonly Entry[] }) {
  const t = useText();
  const last = transcript.at(-1);
  const shown = last?.speaker === "assistant" && last.cardKind !== null ? transcript.slice(0, -1) : transcript;
  if (shown.length === 0) return null;
  const keys = lineKeys(shown);
  return (
    <div role="log" aria-live="off" aria-label={t("chat.log.label")}>
      <ol className="flex flex-col gap-2">
        {shown.map((entry, index) => {
          const own = entry.speaker === "reporter";
          return (
            <li
              key={keys[index]}
              className={cn(
                "max-w-[85%] rounded-card px-3 py-2 text-body",
                own ? "self-end bg-selected [overflow-wrap:anywhere]" : "self-start bg-sunken break-words",
              )}
            >
              {own ? entry.textMasked : breakAfterSlash(questionText(t, entry))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
