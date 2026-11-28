import type { TicketStatus } from "../../domain/stages";
import { type Database, rows, run, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

export type AggregateRowData = {
  readonly hazard_type: string;
  readonly province_code: string;
  readonly regency_code: string;
  readonly number_key: string;
  readonly status: TicketStatus;
  readonly sent_at: string;
  // The first version's values: the place and the event time as the reporter sent them.
  readonly fields: unknown;
  readonly placed_photo: boolean;
};

// Every sent report, newest first: what the weekly counts are made from.
export const aggregateReports = (db: Database) =>
  rows<AggregateRowData>(
    db,
    sql`select r.hazard_type, r.province_code, r.regency_code, r.number_key, t.status, r.sent_at, v.fields,
        exists (select 1 from draft_photo p where p.draft_id = r.draft_id and p.badge in ('deviceGps', 'photoData'))
          as placed_photo
      from report r
      join ticket t on t.report_id = r.id
      join report_version v on v.report_id = r.id and v.version = 1
      order by r.sent_at desc limit 50000`,
  );

export const logAggregateDownload = async (db: Database, staff: StaffPrincipal, at: Date) => {
  await run(
    db,
    sql`insert into aggregate_download (staff_id, staff_label, at) values (${staff.staffId}, ${staff.label}, ${at})`,
  );
};
