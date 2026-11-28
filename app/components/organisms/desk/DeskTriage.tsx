import { Form, useNavigation } from "react-router";
import type { DeskReport } from "../../../../src/contract/desk";
import type { ErrorEnvelope } from "../../../../src/contract/errors";
import type { Text } from "../../../../src/copy/text";
import type { TriageReason } from "../../../../src/domain/triage";
import { cn } from "../../../lib/cn";
import type { DeskArea } from "../../../lib/deskTypes";
import { problemOf } from "../../../lib/envelope";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Select } from "../../atoms/controls";
import { Icon } from "../../atoms/Icon";
import type { IconName } from "../../atoms/icons";
import { ProgressBar } from "../../atoms/ProgressBar";
import { Field } from "../../molecules/Field";

type Triage = DeskReport["triage"];
type Assignment = DeskReport["assignment"];

const TIER_STYLE: Readonly<Record<Triage["tier"], string>> = {
  darurat: "bg-signal text-on-signal border-transparent",
  tinggi: "bg-selected text-primary border-transparent",
  sedang: "bg-surface text-ink border-line",
  rendah: "bg-warn-tint text-ink border-transparent",
};

// How sure the desk can be of a report, in words; the colour repeats them.
export function TriageChip({ triage }: { readonly triage: Pick<Triage, "tier"> }) {
  const t = useText();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-meta font-semibold whitespace-nowrap",
        TIER_STYLE[triage.tier],
      )}
    >
      <Icon name={triage.tier === "darurat" ? "triangleAlert" : "gauge"} className="size-4" />
      {t(`desk.triage.chip.${triage.tier}`)}
    </span>
  );
}

// Held for Pusdalops to check before any BPBD sees it.
export function HeldChip() {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-warn-icon/40 bg-warn-tint px-2 py-0.5 text-meta font-semibold whitespace-nowrap">
      <Icon name="clipboardCheck" className="size-4 text-warn-icon" />
      {t("desk.held.chip")}
    </span>
  );
}

// A BPBD by its area: a province's ("11") is named as one, a regency's or city's by its name.
export const bpbdOf = (t: Text, { area, name }: Pick<Assignment, "area" | "name">): string =>
  t(area.includes(".") ? "desk.assign.bpbd" : "desk.assign.province", { area: name });

// The BPBD that has the report.
export function AssignedLine({ assignment }: { readonly assignment: Assignment }) {
  const t = useText();
  return (
    <span className="inline-flex items-start gap-1.5 text-meta">
      <Icon name="landmark" className="mt-0.5 size-4 shrink-0 text-muted" />
      <span className="min-w-0">{bpbdOf(t, assignment)}</span>
    </span>
  );
}

const SIGN: Readonly<Record<"up" | "down" | "plain" | "life", { icon: IconName; className: string }>> = {
  up: { icon: "circleCheck", className: "text-primary" },
  down: { icon: "triangleAlert", className: "text-warn-icon" },
  plain: { icon: "circleDot", className: "text-muted" },
  life: { icon: "triangleAlert", className: "text-signal" },
};

const UP = new Set<TriageReason>(["gps", "livePhoto", "otherReporters", "handledBefore", "detailed", "modelLikely"]);
const PLAIN = new Set<TriageReason>(["searched", "modelUnsure", "modelOff"]);

function signOf(reason: TriageReason): keyof typeof SIGN {
  if (reason === "lifeAtRisk") return "life";
  if (UP.has(reason)) return "up";
  return PLAIN.has(reason) ? "plain" : "down";
}

// The score as a bar; the words above it say the number.
function ScoreBar({ score }: { readonly score: number }) {
  const t = useText();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-meta font-semibold">{t("desk.triage.score", { score })}</p>
      <ProgressBar percent={score} />
    </div>
  );
}

function useAssigning(): boolean {
  return useNavigation().formData?.get("action") === "assign";
}

// Gives the report to the BPBD it has, out of its hold.
function Release({ report }: { readonly report: DeskReport }) {
  const t = useText();
  const busy = useAssigning();
  return (
    <Form method="post" replace preventScrollReset className="flex flex-col gap-2">
      <input type="hidden" name="action" value="assign" />
      <input type="hidden" name="area" value={report.assignment.area} />
      <input type="hidden" name="revision" value={report.revision} />
      <Button type="submit" variant="primary" busyLabel={busy ? t("desk.busy") : null}>
        <Icon name="send" className="size-5" />
        {t("desk.assign.release", { bpbd: bpbdOf(t, report.assignment) })}
      </Button>
    </Form>
  );
}

// Every province's BPBD before its regencies', the one it has picked.
function Reassign({
  report,
  areas,
  envelope,
}: {
  readonly report: DeskReport;
  readonly areas: readonly DeskArea[];
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const busy = useAssigning();
  const problem = problemOf(envelope, "area");
  const provinces = areas.filter((one) => one.level === "province");
  return (
    // Given on, the form starts closed again at the BPBD it now has.
    <details key={report.assignment.area} className="group" open={problem !== null}>
      <summary className="flex min-h-target-min cursor-pointer list-none items-center gap-1.5 font-semibold text-primary [&::-webkit-details-marker]:hidden">
        <Icon
          name="chevronRight"
          className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {t("desk.assign.other")}
      </summary>
      <Form method="post" preventScrollReset className="flex flex-col gap-3 pt-2">
        <input type="hidden" name="action" value="assign" />
        <input type="hidden" name="revision" value={report.revision} />
        <Field
          id="area"
          label={t("desk.assign.select")}
          hint={t("desk.assign.hint")}
          problem={problem}
          focus={problem !== null}
        >
          {(control) => (
            <Select {...control} defaultValue={report.assignment.area}>
              {provinces.map((province) => (
                <optgroup key={province.area} label={province.name}>
                  <option value={province.area}>{t("desk.assign.province", { area: province.name })}</option>
                  {areas
                    .filter((one) => one.level === "regency" && one.area.startsWith(`${province.area}.`))
                    .map((regency) => (
                      <option key={regency.area} value={regency.area}>
                        {regency.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="secondary" className="self-start" busyLabel={busy ? t("desk.busy") : null}>
          {t("desk.assign.submit")}
        </Button>
      </Form>
    </details>
  );
}

const ENDED = ["closed", "invalid"];

// Which BPBD has the report, whether it waits for Pusdalops, and how sure the desk can be of it,
// with why. Pusdalops may give it on while it is open.
export function DeskAssignment({
  report,
  areas,
  envelope,
}: {
  readonly report: DeskReport;
  readonly areas: readonly DeskArea[] | null;
  readonly envelope: ErrorEnvelope | null;
}) {
  const t = useText();
  const { assignment, triage } = report;
  const mayGive = areas !== null && !ENDED.includes(report.status);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-card font-bold">
          <Icon name="landmark" className="size-5 text-muted" />
          {bpbdOf(t, assignment)}
        </p>
        <p className="text-meta text-muted">
          {t(assignment.held ? "desk.assign.heldLead" : "desk.assign.lead", { bpbd: bpbdOf(t, assignment) })}
        </p>
      </div>
      {assignment.held && mayGive ? <Release report={report} /> : null}
      <div className="flex flex-col gap-3 rounded-control bg-sunken p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <TriageChip triage={triage} />
          {assignment.held ? <HeldChip /> : null}
        </div>
        <ScoreBar score={triage.score} />
        {triage.reasons.length === 0 ? <p className="text-meta">{t("desk.triage.before")}</p> : null}
        <ul className="flex flex-col gap-2 empty:hidden">
          {triage.reasons.map((reason) => {
            const sign = SIGN[signOf(reason)];
            return (
              <li key={reason} className="flex items-start gap-2 text-meta">
                <Icon name={sign.icon} className={cn("mt-0.5 size-4 shrink-0", sign.className)} />
                <span>{t(`desk.triage.reason.${reason}`)}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-meta text-muted">{t("desk.triage.note")}</p>
      </div>
      {mayGive ? <Reassign report={report} areas={areas} envelope={envelope} /> : null}
    </div>
  );
}
