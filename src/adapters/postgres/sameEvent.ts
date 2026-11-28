import type { TicketStatus } from "../../domain/stages";
import { type Database, rows, sql } from "../../platform/database";

export type CandidateRow = {
  readonly ticket_number: string;
  readonly hazard_type: string;
  readonly status: TicketStatus;
  readonly sent_at: string;
  readonly fields: unknown;
};

const LATEST = sql`(select max(m.version) from report_version m where m.report_id = r.id)`;

// Reports sent in a district since a time, newest first: what a reporter there may be telling of too.
export const districtReports = (db: Database, districtCode: string, since: Date) =>
  rows<CandidateRow>(
    db,
    sql`select r.ticket_number, r.hazard_type, t.status, r.sent_at, v.fields
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = ${LATEST}
      where r.district_code = ${districtCode} and r.sent_at > ${since}
      order by r.sent_at desc limit 150`,
  );
