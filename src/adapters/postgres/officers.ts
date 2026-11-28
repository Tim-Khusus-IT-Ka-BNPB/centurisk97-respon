import { type Database, run, sql } from "../../platform/database";
import type { StaffPrincipal } from "../../ports/identity";

// A BNPB officer opened a BPBD officer's full number on this report.
export const logOfficerNumber = (
  db: Database,
  staff: StaffPrincipal,
  ticketNumber: string,
  profileId: string,
  at: Date,
): Promise<number> =>
  run(
    db,
    sql`insert into officer_number_view (ticket_number, staff_id, staff_label, profile_id, at)
      values (${ticketNumber}, ${staff.staffId}, ${staff.label}, ${profileId}, ${at})`,
  );
