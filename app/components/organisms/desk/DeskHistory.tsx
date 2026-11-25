import type { DeskReport } from "../../../../src/contract/desk";
import type { Text } from "../../../../src/copy/text";
import { useText } from "../../../lib/text";
import { when } from "./parts";

type History = DeskReport["history"];

// A history row's name: the status it reached, or the work it tells of.
function historyTitle(t: Text, entry: History[number]): string {
  if (entry.event === "actions") return t("desk.handling.actions");
  if (entry.event === "take") return t("desk.taker", { taker: entry.detail?.taker as string });
  if (entry.event === "fieldCheck")
    return t("desk.history.check", { result: `desk.check.result.${entry.detail?.result}` });
  return t(`stage.long.${entry.status}`);
}

// What happened to the ticket, oldest first.
export function DeskHistory({ history }: { readonly history: History }) {
  const t = useText();
  return (
    <ol className="flex flex-col">
      {history.map((entry, index) => (
        <li key={`${entry.status}-${entry.at.utc}`} className="relative flex gap-3 pb-4 last:pb-0">
          <span className="flex flex-col items-center">
            <span className="mt-1.5 size-2.5 rounded-full bg-primary" aria-hidden="true" />
            {index < history.length - 1 ? <span className="mt-1 w-px flex-1 bg-line" aria-hidden="true" /> : null}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">{historyTitle(t, entry)}</span>
            <span className="text-meta text-muted tabular-nums">{when(t, "desk.history.at", entry.at)}</span>
            <span className="text-meta">{entry.actor ?? t("desk.history.system")}</span>
            {(entry.detail?.changes ?? []).map((change) => (
              <span key={change.fieldId}>
                {t("desk.history.change", {
                  label: `field.${change.fieldId}.label`,
                  from: change.from === null ? "desk.impact.unknown" : change.from,
                  to: change.to,
                })}
              </span>
            ))}
            {entry.detail?.actions ? <span>{entry.detail.actions.join(", ")}</span> : null}
            {entry.forwardedTo === null ? null : (
              <span>{t("desk.history.forwardedTo", { regency: entry.forwardedTo })}</span>
            )}
            {entry.note === null ? null : <span>{entry.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
