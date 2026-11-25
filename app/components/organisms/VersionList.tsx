import type { ReactNode } from "react";
import type { ReportVersion } from "../../../src/contract/ownReport";
import type { Text } from "../../../src/copy/text";
import { clockTime, shortDate } from "../../../src/copy/time";
import { rowParts } from "../../../src/copy/values";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";

type Change = ReportVersion["changes"][number];

// What a value said at one time: the value in the summary's words, or the words of its empty state.
function told(t: Text, row: Change["from"], hazardType: string | null): string {
  if (row === null) return t("state.notYetKnown");
  const parts = rowParts(t, row, hazardType);
  return parts.value ?? t(`state.${parts.state}`);
}

// The values that changed, each with what it said before and says now.
export function ChangeList({
  changes,
  hazardType,
}: {
  readonly changes: readonly Change[];
  readonly hazardType: string | null;
}) {
  const t = useText();
  return (
    <ul className="flex flex-col gap-1">
      {changes.map((change) => (
        <li key={change.fieldId} className="min-w-0 break-words">
          <span className="text-muted">{t(t.variant(`field.${change.fieldId}.label`, hazardType))}: </span>
          {t("version.change", { from: told(t, change.from, hazardType) })}{" "}
          <span className="font-semibold">{told(t, change.to, hazardType)}</span>
        </li>
      ))}
    </ul>
  );
}

// The two files of a version, side by side. What each button is comes from the page: a link on the
// reporter's, a form's button on the desk.
export function FileButtons({
  version,
  button,
}: {
  readonly version: number;
  readonly button: (
    format: "pdf" | "docx",
    look: { readonly className: string; readonly label: string },
    children: ReactNode,
  ) => ReactNode;
}) {
  const t = useText();
  const one = (format: "pdf" | "docx") =>
    button(
      format,
      {
        className: buttonStyles({ variant: "secondary", size: "min", className: "flex-1 @actions:flex-none" }),
        label: t(`version.download.${format}Label`, { version }),
      },
      <>
        <Icon name="download" className="size-5" />
        {t(`version.download.${format}`)}
      </>,
    );
  return (
    <div className="flex shrink-0 gap-2">
      {one("pdf")}
      {one("docx")}
    </div>
  );
}

// Every version of a report, the newest first: who made it, when, what it changed, and its files.
export function VersionList({
  versions,
  hazardType,
  voice,
  files,
}: {
  readonly versions: readonly ReportVersion[];
  readonly hazardType: string | null;
  // The reporter is told "Anda"; staff are told "pelapor".
  readonly voice: "own" | "desk";
  readonly files: (version: number) => ReactNode;
}) {
  const t = useText();
  return (
    <ol className="flex flex-col divide-y divide-line">
      {versions.map((one, index) => {
        const maker = one.madeBy === "officer" ? "officer" : one.version === 1 ? "first" : "reporter";
        return (
          <li key={one.version} className="@container flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-3 @actions:flex-row @actions:items-start @actions:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-selected text-primary">
                  <Icon name="fileText" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{t("version.name", { version: one.version })}</span>
                    {index === 0 && versions.length > 1 ? (
                      <span className="rounded-chip bg-selected px-2 py-0.5 text-meta font-semibold text-primary">
                        {t("version.newest")}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-meta text-muted tabular-nums">
                    {t(`version.maker.${voice}.${maker}`)}
                    {", "}
                    {t("version.at", { date: shortDate(one.at), time: clockTime(one.at), zone: one.at.zone })}
                  </p>
                </div>
              </div>
              {files(one.version)}
            </div>
            {one.changes.length === 0 ? null : <ChangeList changes={one.changes} hazardType={hazardType} />}
          </li>
        );
      })}
    </ol>
  );
}
