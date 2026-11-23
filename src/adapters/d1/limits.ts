import { atomically, type Database, holds, row, sql } from "../../platform/database";

// Reads and raises one counter in one statement; the count returned includes this request.
export async function hitCounter(
  db: Database,
  limitId: string,
  subjectKey: string,
  windowStart: Date,
): Promise<number> {
  const found = await row<{ count: number }>(
    db,
    sql`insert into rate_counter (limit_id, subject_key, window_start, count)
      values (${limitId}, ${subjectKey}, ${windowStart}, 1)
      on conflict (limit_id, subject_key, window_start) do update set count = count + 1
      returning count`,
  );
  return (found as { count: number }).count;
}

// Counts one model call for the draft and for the number's WIB day, only while both are under
// their caps. The call is counted before it starts, so an aborted call counts too.
export async function claimModelCall(
  db: Database,
  draftId: string,
  numberKey: string,
  wibDate: string,
  caps: { readonly draft: number; readonly day: number },
): Promise<boolean> {
  const claimed = await atomically(db, [
    sql`update report_draft set model_calls = model_calls + 1 where id = ${draftId} and model_calls < ${caps.draft}`,
    holds(sql`changes() = 1`),
    sql`insert into model_usage (number_key, wib_date, calls) values (${numberKey}, ${wibDate}, 1)
      on conflict (number_key, wib_date) do update set calls = calls + 1`,
    holds(
      sql`(select calls from model_usage where number_key = ${numberKey} and wib_date = ${wibDate}) <= ${caps.day}`,
    ),
  ]);
  return claimed !== null;
}
