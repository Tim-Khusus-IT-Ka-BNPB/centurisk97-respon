import type { CaseView } from "../../../../src/contract/cases";
import type { useText } from "../../../lib/text";

type CaseRecord = CaseView["records"][number];

// A record as others point to it: its kind and number, and a shelter's own name.
export function recordName(t: ReturnType<typeof useText>, record: CaseRecord): string {
  const title = t("desk.case.recordTitle", { kind: `desk.case.kind.${record.kind}`, seq: record.seq });
  const name = record.kind === "shelter" ? record.data.name : undefined;
  return typeof name === "string" ? t("desk.case.recordNamed", { title, name }) : title;
}
