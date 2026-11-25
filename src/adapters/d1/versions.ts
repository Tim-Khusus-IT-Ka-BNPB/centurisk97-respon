import type { EmergencyKind, VictimAnswer } from "../../domain/emergency";
import type { FieldStates } from "../../domain/fieldState";
import type { ReporterRole } from "../../domain/identityForm";
import { type Database, parsed, row, rows, sql } from "../../platform/database";

// Who made a version: the reporter by sending or adding news, or an officer by a check on site.
type VersionMaker = "reporter" | "officer";

type VersionRow = {
  readonly version: number;
  readonly createdAt: Date;
  readonly madeBy: VersionMaker;
  readonly states: FieldStates;
};

type Stored = { version: number; created_at: string; fields: string; note: string | null };

// The note of the check that made a version tells an officer's from a reporter's.
const CHECK_NOTE = sql`(select c.note from field_check c where c.ticket_number = r.ticket_number and c.version = v.version)`;

const versionRow = (found: Stored): VersionRow => ({
  version: found.version,
  createdAt: new Date(found.created_at),
  madeBy: found.note === null ? "reporter" : "officer",
  states: parsed<FieldStates>(found.fields) as FieldStates,
});

// Every version of a report, the first one first.
export async function reportVersions(db: Database, ticketNumber: string): Promise<VersionRow[]> {
  const found = await rows<Stored>(
    db,
    sql`select v.version, v.created_at, v.fields, ${CHECK_NOTE} as note
      from report_version v join report r on r.id = v.report_id
      where r.ticket_number = ${ticketNumber} order by v.version`,
  );
  return found.map(versionRow);
}

type VersionDetail = VersionRow & {
  readonly reporterRole: ReporterRole;
  readonly officerRegency: string | null;
  readonly numberUnverified: boolean;
  readonly note: string | null;
  readonly draftId: string;
  readonly villageCode: string;
  readonly sentAt: Date;
  readonly emergency: { readonly kind: EmergencyKind; readonly victims: VictimAnswer } | null;
};

type StoredDetail = Stored & {
  reporter_role: ReporterRole;
  officer_regency: string | null;
  number_unverified: number;
  draft_id: string;
  village_code: string;
  sent_at: string;
  emergency: EmergencyKind | null;
  emergency_victims: VictimAnswer | null;
};

// What a document tells of its report, and the officer's note when a check made the version.
export async function versionDetail(
  db: Database,
  ticketNumber: string,
  version: number,
): Promise<VersionDetail | null> {
  const found = await row<StoredDetail>(
    db,
    sql`select v.version, v.created_at, v.fields, ${CHECK_NOTE} as note, v.reporter_role, v.officer_regency,
        r.number_unverified, r.draft_id, r.village_code, r.sent_at, r.emergency, r.emergency_victims
      from report_version v join report r on r.id = v.report_id
      where r.ticket_number = ${ticketNumber} and v.version = ${version}`,
  );
  return found === null
    ? null
    : {
        ...versionRow(found),
        reporterRole: found.reporter_role,
        officerRegency: found.officer_regency,
        numberUnverified: found.number_unverified === 1,
        note: found.note,
        draftId: found.draft_id,
        villageCode: found.village_code,
        sentAt: new Date(found.sent_at),
        emergency:
          found.emergency === null ? null : { kind: found.emergency, victims: found.emergency_victims as VictimAnswer },
      };
}
