import { type Database, row, rows, sql } from "../../platform/database";

// Other numbers that reported the same hazard in the same district since then.
export async function otherReporters(
  db: Database,
  report: {
    readonly hazardType: string;
    readonly districtCode: string;
    readonly numberKey: string;
    readonly since: Date;
  },
): Promise<number> {
  const found = await row<{ count: number }>(
    db,
    sql`select count(distinct number_key) as count from report
      where hazard_type = ${report.hazardType} and district_code = ${report.districtCode}
        and number_key <> ${report.numberKey} and sent_at > ${report.since}`,
  );
  return (found as { count: number }).count;
}

// What a number's reports came to: one found not to be true outweighs one handled.
export async function numberHistory(db: Database, numberKey: string): Promise<"handled" | "none" | "invalid"> {
  const found = (await row<{ invalid: boolean | null; handled: boolean | null }>(
    db,
    sql`select bool_or(t.status = 'invalid') as invalid, bool_or(t.status = 'closed') as handled
      from report r join ticket t on t.report_id = r.id where r.number_key = ${numberKey}`,
  )) as { invalid: boolean | null; handled: boolean | null };
  if (found.invalid) return "invalid";
  return found.handled ? "handled" : "none";
}

// The reporter's own lines of a draft, in Indonesian where they were in another language.
export async function reporterLines(db: Database, draftId: string): Promise<string[]> {
  const found = await rows<{ text: string }>(
    db,
    sql`select coalesce(text_indonesian, text_masked) as text from draft_message
      where draft_id = ${draftId} and speaker = 'reporter' order by seq`,
  );
  return found.map((one) => one.text);
}
