// Every column has a data class and every table a retention rule. schema.test.ts fails on a
// column that is missing here, so a new column cannot land unclassified.
export type DataClass = "public" | "internal" | "personal" | "specific";

type TableClasses = { readonly retention: string; readonly columns: Readonly<Record<string, DataClass>> };

const I = "internal";
const P = "personal";
const PUB = "public";

export const COLUMN_CLASSES: Readonly<Record<string, TableClasses>> = {
  batch_guard: {
    retention: "always empty: every guarded batch deletes its own rows before it ends",
    columns: { ok: I },
  },
  reporter: {
    retention: "deleted when no profile and no seeded session uses it",
    columns: { id: I, number: P, number_key: I, created_at: I },
  },
  device: {
    retention: "365 days after last_seen_at, swept",
    columns: { id: I, key_fingerprint: I, created_at: I, last_seen_at: I },
  },
  reporter_profile: {
    retention: "until removed from the device, or deleted with the device",
    columns: {
      id: I,
      reporter_id: I,
      owner_slot: I,
      device_id: I,
      name: P,
      role: I,
      officer_regency: P,
      officer_position: P,
      created_at: I,
      last_used_at: I,
    },
  },
  reporter_consent: {
    retention: "with its profile; a sent version keeps its own copy",
    columns: { id: I, profile_id: I, privacy_version: I, agreed_at: I },
  },
  seeded_session: {
    retention: "seed data, local, test and staging only",
    columns: { token_hash: I, kind: I, reporter_id: I, staff_role: I },
  },
  report_draft: {
    retention: "content nulled at send, cancel, expiry or removal; the empty row 30 days after ended_at, swept",
    columns: {
      id: I,
      reporter_id: I,
      profile_id: I,
      owner_slot: I,
      state: I,
      revision: I,
      fields: P,
      back_stack: P,
      asked: I,
      off_topic_count: I,
      model_calls: I,
      templates_only: I,
      village_code: PUB,
      hazard_type: I,
      created_at: I,
      last_acted_at: I,
      ended_at: I,
      end_reason: I,
      pending_notices: I,
    },
  },
  draft_message: {
    retention: "deleted with draft content; kept with the report once sent",
    columns: {
      id: I,
      draft_id: I,
      seq: I,
      speaker: I,
      text_masked: P,
      copy_key: I,
      params: I,
      card_kind: I,
      prompt_key: I,
      created_at: I,
    },
  },
  turn_reply: {
    retention: "24 hours, and deleted with draft content",
    columns: { draft_id: I, turn_key: I, request_hash: I, status: I, body: P, created_at: I },
  },
  report: {
    retention: "waits on counsel; no delete in this release",
    columns: {
      id: I,
      ticket_number: I,
      draft_id: I,
      reporter_id: I,
      number_key: I,
      owner_slot: I,
      number_unverified: I,
      hazard_type: I,
      village_code: I,
      district_code: I,
      regency_code: I,
      province_code: I,
      sent_at: I,
    },
  },
  report_version: {
    retention: "with the report; append-only",
    columns: {
      report_id: I,
      version: I,
      fields: P,
      reporter_name: P,
      reporter_number: P,
      reporter_role: I,
      officer_regency: P,
      officer_position: P,
      privacy_version: I,
      consent_agreed_at: I,
      complete_percent: I,
      created_at: I,
    },
  },
  ticket: { retention: "with the report", columns: { ticket_number: I, report_id: I, status: I, updated_at: I } },
  ticket_history: {
    retention: "with the report; append-only",
    columns: { id: I, ticket_number: I, from_status: I, to_status: I, actor: I, note: I, at: I },
  },
  ticket_day_counter: { retention: "kept, one row a day", columns: { wib_date: I, last_n: I } },
  rate_counter: {
    retention: "1 day after the window ends, swept",
    columns: { limit_id: I, subject_key: I, window_start: I, count: I },
  },
  model_usage: { retention: "2 days, swept", columns: { number_key: I, wib_date: I, calls: I } },
  place_snapshot: {
    retention: "last 2 snapshots",
    columns: {
      id: I,
      source: I,
      data_date: PUB,
      imported_at: I,
      village_count: I,
      regency_count: I,
      checksum: I,
      active: I,
    },
  },
  place_regency: {
    retention: "with its snapshot",
    columns: {
      snapshot_id: I,
      code: PUB,
      name: PUB,
      province_code: PUB,
      province_name: PUB,
      village_count: PUB,
      search_text: PUB,
    },
  },
  place_district: {
    retention: "with its snapshot",
    columns: {
      snapshot_id: I,
      code: PUB,
      name: PUB,
      regency_code: PUB,
      regency_name: PUB,
      province_code: PUB,
      province_name: PUB,
      village_count: PUB,
      search_text: PUB,
    },
  },
  place_village: {
    retention: "with its snapshot",
    columns: {
      snapshot_id: I,
      code: PUB,
      name: PUB,
      district_name: PUB,
      regency_code: PUB,
      regency_name: PUB,
      province_code: PUB,
      province_name: PUB,
      search_text: PUB,
    },
  },
};
