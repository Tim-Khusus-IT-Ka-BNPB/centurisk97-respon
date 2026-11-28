import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Respon's database (docs/decisions/0014 in centurisk97-platform). drizzle-kit makes the migrations
// in db/migrations from this file; the triggers, which Drizzle does not model, close 0000 by hand.
// Instants are timestamptz, read back as ISO 8601 text in UTC (src/platform/database.ts); days are
// date, read back as YYYY-MM-DD.

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const day = (name: string) => date(name, { mode: "string" });
const serial = () => bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity();
const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((value) => `'${value}'`).join(", ")})`);

// Indonesian mobile numbers in E.164: +628 then 8 to 12 digits.
const MOBILE = sql.raw(String.raw`~ '^\+628[0-9]{8,12}$'`);
const REGENCY_CODE = String.raw`'^[0-9]{2}\.[0-9]{2}$'`;
const DISTRICT_CODE = String.raw`'^[0-9]{2}\.[0-9]{2}\.[0-9]{2}$'`;
const VILLAGE_CODE = String.raw`'^[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}$'`;
const STAFF_ROLES = ["deskOfficer", "regionalOfficer"];
const SCOPE_LEVELS = ["national", "province", "regency"];
const REPORTER_ROLES = ["citizen", "claimedOfficer"];
const WARNING_HAZARDS = ["BNJ", "LSR", "ASP", "CEX"];

// Reporters, their devices and profiles

export const reporter = pgTable(
  "reporter",
  {
    id: text().primaryKey(),
    number: text().notNull(),
    number_key: text().notNull().unique(),
    created_at: at("created_at").notNull(),
  },
  (t) => [check("reporter_number", sql`${t.number} ${MOBILE}`)],
);

export const device = pgTable("device", {
  id: text().primaryKey(),
  key_fingerprint: text().notNull().unique(),
  created_at: at("created_at").notNull(),
  last_seen_at: at("last_seen_at").notNull(),
});

export const reporterProfile = pgTable(
  "reporter_profile",
  {
    id: text().primaryKey(),
    reporter_id: text()
      .notNull()
      .references(() => reporter.id),
    owner_slot: text().notNull(),
    device_id: text().references(() => device.id, { onDelete: "cascade" }),
    name: text().notNull(),
    role: text().notNull(),
    officer_regency: text(),
    officer_position: text(),
    created_at: at("created_at").notNull(),
    last_used_at: at("last_used_at").notNull(),
  },
  (t) => [
    unique().on(t.reporter_id, t.owner_slot),
    index("reporter_profile_device").on(t.device_id),
    check("reporter_profile_name", sql`length(${t.name}) between 2 and 80 and ${t.name} !~ '[0-9]'`),
    check("reporter_profile_role", oneOf("role", REPORTER_ROLES)),
    check(
      "reporter_profile_officer_regency",
      sql`${t.officer_regency} is null or length(${t.officer_regency}) between 3 and 80`,
    ),
    check(
      "reporter_profile_officer_position",
      sql`${t.officer_position} is null or length(${t.officer_position}) between 2 and 80`,
    ),
    // The slot is the device id for a device binding, or "session" for a signed-in session.
    check(
      "reporter_profile_slot",
      sql`(${t.device_id} is null and ${t.owner_slot} = 'session') or (${t.device_id} is not null and ${t.owner_slot} = ${t.device_id})`,
    ),
    check(
      "reporter_profile_officer",
      sql`(${t.role} = 'claimedOfficer') = (${t.officer_regency} is not null and ${t.officer_position} is not null)`,
    ),
  ],
);

export const reporterConsent = pgTable(
  "reporter_consent",
  {
    id: text().primaryKey(),
    profile_id: text()
      .notNull()
      .references(() => reporterProfile.id, { onDelete: "cascade" }),
    privacy_version: integer().notNull(),
    agreed_at: at("agreed_at").notNull(),
  },
  (t) => [
    index("reporter_consent_profile").on(t.profile_id, t.agreed_at),
    check("reporter_consent_version", sql`${t.privacy_version} >= 1`),
  ],
);

// Local, test and staging sign people in with seeded codes; only a fingerprint of each is kept.
export const seededSession = pgTable(
  "seeded_session",
  {
    token_hash: text().primaryKey(),
    kind: text().notNull(),
    reporter_id: text().references(() => reporter.id, { onDelete: "cascade" }),
    staff_role: text(),
    staff_id: text(),
    staff_label: text(),
    scope_level: text(),
    scope_code: text(),
    profile_id: text(),
    profile_name: text(),
    profile_position: text(),
    agency: text(),
    profile_number: text(),
  },
  (t) => [
    check("seeded_session_kind", oneOf("kind", ["reporter", "staff"])),
    check("seeded_session_staff_role", oneOf("staff_role", STAFF_ROLES)),
    check("seeded_session_scope_level", oneOf("scope_level", SCOPE_LEVELS)),
    check(
      "seeded_session_reporter",
      sql`(${t.kind} = 'reporter') = (${t.reporter_id} is not null and ${t.staff_role} is null)`,
    ),
    check(
      "seeded_session_staff",
      sql`(${t.kind} = 'staff') = (${t.staff_role} is not null and ${t.reporter_id} is null)`,
    ),
  ],
);

// Drafts and the conversation that fills them

const FINAL_STATES = ["sent", "cancelled", "expired"];

export const reportDraft = pgTable(
  "report_draft",
  {
    id: text().primaryKey(),
    reporter_id: text()
      .notNull()
      .references(() => reporter.id, { onDelete: "cascade" }),
    profile_id: text().references(() => reporterProfile.id, { onDelete: "set null" }),
    owner_slot: text().notNull(),
    state: text().notNull(),
    revision: integer().notNull().default(0),
    fields: jsonb(),
    back_stack: jsonb(),
    asked: jsonb().notNull().default({}),
    off_topic_count: integer().notNull().default(0),
    model_calls: integer().notNull().default(0),
    templates_only: boolean().notNull().default(false),
    village_code: text(),
    hazard_type: text(),
    // What the reporter still has to be shown after a turn (a danger warning, the 112 line), as copy
    // keys. Every turn ends in a redirect, so the next read shows them once and clears them.
    pending_notices: jsonb(),
    created_at: at("created_at").notNull(),
    last_acted_at: at("last_acted_at").notNull(),
    ended_at: at("ended_at"),
    end_reason: text(),
    follow_up_of: text().references((): AnyPgColumn => report.id),
  },
  (t) => [
    uniqueIndex("report_draft_one_open")
      .on(t.reporter_id, t.owner_slot)
      .where(sql.raw(`state not in ('sent', 'cancelled', 'expired')`)),
    index("report_draft_last_acted")
      .on(t.last_acted_at)
      .where(sql.raw(`state not in ('sent', 'cancelled', 'expired')`)),
    index("report_draft_ended").on(t.ended_at).where(sql`${t.ended_at} is not null`),
    index("report_draft_reporter").on(t.reporter_id),
    index("report_draft_profile").on(t.profile_id),
    index("report_draft_follow_up_of").on(t.follow_up_of),
    check(
      "report_draft_state",
      oneOf("state", [
        "place",
        "place_confirm",
        "neighbourhood",
        "asking",
        "guided_chronology",
        "free_story",
        "photos",
        "summary",
        ...FINAL_STATES,
      ]),
    ),
    check("report_draft_revision", sql`${t.revision} >= 0`),
    check("report_draft_off_topic_count", sql`${t.off_topic_count} >= 0`),
    check("report_draft_model_calls", sql`${t.model_calls} >= 0`),
    check("report_draft_end_reason", oneOf("end_reason", ["sent", "cancelled", "expired", "removedNumber"])),
    // A final draft holds no personal content.
    check(
      "report_draft_final",
      sql`${t.state} not in ('sent', 'cancelled', 'expired') or (${t.fields} is null and ${t.back_stack} is null and ${t.ended_at} is not null)`,
    ),
  ],
);

export const draftMessage = pgTable(
  "draft_message",
  {
    id: serial(),
    draft_id: text()
      .notNull()
      .references(() => reportDraft.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    speaker: text().notNull(),
    text_masked: text(),
    copy_key: text(),
    // The question an assistant line asked, beside its heading, so the history shows the question
    // itself (a guided step's heading is only its progress).
    prompt_key: text(),
    params: jsonb(),
    card_kind: text(),
    created_at: at("created_at").notNull(),
  },
  (t) => [
    unique().on(t.draft_id, t.seq),
    check("draft_message_seq", sql`${t.seq} >= 1`),
    check("draft_message_speaker", oneOf("speaker", ["reporter", "assistant"])),
    check(
      "draft_message_text",
      sql`(${t.speaker} = 'reporter') = (${t.text_masked} is not null and ${t.copy_key} is null)`,
    ),
  ],
);

export const turnReply = pgTable(
  "turn_reply",
  {
    draft_id: text()
      .notNull()
      .references(() => reportDraft.id, { onDelete: "cascade" }),
    turn_key: text().notNull(),
    request_hash: text().notNull(),
    status: integer().notNull(),
    body: jsonb().notNull(),
    created_at: at("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.draft_id, t.turn_key] }), index("turn_reply_created").on(t.created_at)],
);

// Reports, tickets and what the desk does with them

export const report = pgTable(
  "report",
  {
    id: text().primaryKey(),
    ticket_number: text().notNull().unique(),
    // One ticket per draft: the backstop behind the send.
    draft_id: text()
      .notNull()
      .unique()
      .references(() => reportDraft.id),
    reporter_id: text().references(() => reporter.id, { onDelete: "set null" }),
    number_key: text().notNull(),
    owner_slot: text().notNull(),
    number_unverified: boolean().notNull(),
    hazard_type: text().notNull(),
    village_code: text().notNull(),
    district_code: text().notNull(),
    regency_code: text().notNull(),
    province_code: text().notNull(),
    sent_at: at("sent_at").notNull(),
    tracking_hash: text(),
    emergency: text(),
    emergency_victims: text(),
  },
  (t) => [
    index("report_sends").on(t.number_key, t.owner_slot, t.sent_at),
    index("report_sent").on(t.sent_at),
    index("report_emergency").on(t.sent_at).where(sql`${t.emergency} is not null`),
    index("report_reporter").on(t.reporter_id),
    uniqueIndex("report_tracking_hash").on(t.tracking_hash).where(sql`${t.tracking_hash} is not null`),
    check("report_ticket_number", sql.raw(`ticket_number ~ '^LA-[0-9]{6}-[0-9]{2,}$'`)),
    check("report_emergency", oneOf("emergency", ["chat", "oneTap"])),
    check("report_emergency_victims", oneOf("emergency_victims", ["yes", "no", "unknown"])),
  ],
);

export const reportVersion = pgTable(
  "report_version",
  {
    report_id: text()
      .notNull()
      .references(() => report.id),
    version: integer().notNull(),
    fields: jsonb().notNull(),
    reporter_name: text().notNull(),
    reporter_number: text().notNull(),
    reporter_role: text().notNull(),
    officer_regency: text(),
    officer_position: text(),
    privacy_version: integer().notNull(),
    consent_agreed_at: at("consent_agreed_at").notNull(),
    complete_percent: integer().notNull(),
    created_at: at("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.report_id, t.version] }),
    check("report_version_version", sql`${t.version} >= 1`),
    check("report_version_reporter_role", oneOf("reporter_role", REPORTER_ROLES)),
    check("report_version_complete_percent", sql`${t.complete_percent} between 0 and 100`),
  ],
);

export const ticket = pgTable(
  "ticket",
  {
    ticket_number: text()
      .primaryKey()
      .references(() => report.ticket_number),
    report_id: text()
      .notNull()
      .unique()
      .references(() => report.id),
    status: text().notNull(),
    updated_at: at("updated_at").notNull(),
    revision: integer().notNull().default(0),
  },
  (t) => [
    index("ticket_status").on(t.status),
    check(
      "ticket_status",
      oneOf("status", ["new", "seen", "under_review", "forwarded", "in_handling", "closed", "invalid"]),
    ),
  ],
);

export const ticketDayCounter = pgTable(
  "ticket_day_counter",
  { wib_date: day("wib_date").primaryKey(), last_n: integer().notNull() },
  (t) => [check("ticket_day_counter_last_n", sql`${t.last_n} >= 1`)],
);

export const ticketHistory = pgTable(
  "ticket_history",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    from_status: text(),
    to_status: text().notNull(),
    actor: text().notNull(),
    actor_id: text(),
    actor_label: text(),
    note: text(),
    at: at("at").notNull(),
    event: text(),
    detail: jsonb(),
  },
  (t) => [
    index("ticket_history_ticket").on(t.ticket_number, t.at),
    check("ticket_history_actor", oneOf("actor", ["system", "staff", "reporter"])),
    check(
      "ticket_history_event",
      oneOf("event", ["fieldCheck", "actions", "take", "followUp", "released", "commentFigure"]),
    ),
    check(
      "ticket_history_staff",
      sql`(${t.actor} = 'staff') = (${t.actor_id} is not null and ${t.actor_label} is not null)`,
    ),
    check("ticket_history_reporter", sql`${t.actor} <> 'reporter' or ${t.event} is not distinct from 'followUp'`),
  ],
);

export const reportRating = pgTable(
  "report_rating",
  {
    report_id: text()
      .primaryKey()
      .references(() => report.id),
    rating: integer().notNull(),
    rated_at: at("rated_at").notNull(),
  },
  (t) => [check("report_rating_rating", sql`${t.rating} between 1 and 5`)],
);

export const reportReply = pgTable(
  "report_reply",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    text: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    index("report_reply_ticket").on(t.ticket_number, t.at),
    check("report_reply_text", sql`length(${t.text}) between 1 and 1000`),
  ],
);

export const fieldCheck = pgTable(
  "field_check",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    result: text().notNull(),
    note: text().notNull(),
    // The version the correction made, or null with none.
    version: integer(),
    at: at("at").notNull(),
    checker_role: text(),
    checker_level: text(),
    checker_code: text(),
  },
  (t) => [
    index("field_check_ticket").on(t.ticket_number, t.at),
    check("field_check_result", oneOf("result", ["valid", "partly", "notValid"])),
    check("field_check_note", sql`length(${t.note}) between 5 and 1000`),
    check("field_check_checker_role", oneOf("checker_role", STAFF_ROLES)),
    check("field_check_checker_level", oneOf("checker_level", SCOPE_LEVELS)),
  ],
);

export const handlingAction = pgTable(
  "handling_action",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    code: text(),
    label: text().notNull(),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    unique().on(t.ticket_number, t.label),
    check("handling_action_label", sql`length(${t.label}) between 3 and 120`),
  ],
);

export const handlingProof = pgTable(
  "handling_proof",
  {
    id: text().primaryKey(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    store_key: text().notNull().unique(),
    bytes: integer().notNull(),
    lat: doublePrecision(),
    lon: doublePrecision(),
    accuracy_m: doublePrecision(),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    received_at: at("received_at").notNull(),
  },
  (t) => [
    index("handling_proof_ticket").on(t.ticket_number, t.received_at),
    check("handling_proof_bytes", sql`${t.bytes} > 0`),
    check("handling_proof_lat", sql`${t.lat} is null or ${t.lat} between -90 and 90`),
    check("handling_proof_lon", sql`${t.lon} is null or ${t.lon} between -180 and 180`),
    check(
      "handling_proof_point",
      sql`(${t.lat} is null) = (${t.lon} is null) and (${t.lat} is null) = (${t.accuracy_m} is null)`,
    ),
  ],
);

export const proofPublication = pgTable(
  "proof_publication",
  {
    id: serial(),
    proof_id: text()
      .notNull()
      .references(() => handlingProof.id),
    public: boolean().notNull(),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [index("proof_publication_proof").on(t.proof_id, t.id)],
);

export const reportTaker = pgTable(
  "report_taker",
  {
    ticket_number: text()
      .primaryKey()
      .references(() => ticket.ticket_number),
    profile_id: text().notNull(),
    staff_id: text().notNull(),
    label: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [check("report_taker_label", sql`length(${t.label}) between 5 and 300`)],
);

export const reportNews = pgTable("report_news", {
  report_id: text()
    .primaryKey()
    .references(() => report.id),
  read_at: at("read_at").notNull(),
  stopped: boolean().notNull().default(false),
  changed_at: at("changed_at").notNull(),
});

export const reportLink = pgTable(
  "report_link",
  {
    ticket_number: text()
      .primaryKey()
      .references(() => ticket.ticket_number),
    same_as: text()
      .notNull()
      .references(() => ticket.ticket_number),
    at: at("at").notNull(),
  },
  (t) => [
    index("report_link_same_as").on(t.same_as),
    check("report_link_other", sql`${t.same_as} <> ${t.ticket_number}`),
  ],
);

export const eventDayCounter = pgTable(
  "event_day_counter",
  { wib_date: day("wib_date").primaryKey(), last_n: integer().notNull() },
  (t) => [check("event_day_counter_last_n", sql`${t.last_n} >= 1`)],
);

export const reportEvent = pgTable(
  "report_event",
  {
    ticket_number: text()
      .primaryKey()
      .references(() => ticket.ticket_number),
    code: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [index("report_event_code").on(t.code), check("report_event_code", sql.raw(`code ~ '^KJ-[0-9]{6}-[0-9]{2}'`))],
);

export const staffAction = pgTable(
  "staff_action",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    staff_kind: text().notNull(),
    action: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    index("staff_action_ticket").on(t.ticket_number, t.at),
    check("staff_action_staff_kind", oneOf("staff_kind", STAFF_ROLES)),
    check(
      "staff_action_action",
      oneOf("action", [
        "view",
        "identityView",
        "status",
        "reply",
        "fieldCheck",
        "handlingAction",
        "handlingProof",
        "take",
        "document",
      ]),
    ),
  ],
);

export const officerNumberView = pgTable(
  "officer_number_view",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    profile_id: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [index("officer_number_view_ticket").on(t.ticket_number, t.at)],
);

export const todayPull = pgTable(
  "today_pull",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    pulled: boolean().notNull(),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [index("today_pull_ticket").on(t.ticket_number, t.id)],
);

export const aggregateDownload = pgTable("aggregate_download", {
  id: serial(),
  staff_id: text().notNull(),
  staff_label: text().notNull(),
  at: at("at").notNull(),
});

// What the reporter hears back

export const notice = pgTable(
  "notice",
  {
    id: serial(),
    ticket_number: text()
      .notNull()
      .references(() => ticket.ticket_number),
    kind: text().notNull(),
    // A row of ticket_history; no foreign key, as before.
    history_id: bigint({ mode: "number" }),
    reply_id: bigint({ mode: "number" }).references(() => reportReply.id),
    at: at("at").notNull(),
  },
  (t) => [
    index("notice_ticket").on(t.ticket_number, t.at),
    index("notice_at").on(t.at),
    index("notice_reply").on(t.reply_id),
    check("notice_kind", oneOf("kind", ["status", "reply", "actions", "correction"])),
    check("notice_reply", sql`(${t.kind} = 'reply') = (${t.reply_id} is not null)`),
    check("notice_history", sql`(${t.kind} = 'reply') = (${t.history_id} is null)`),
  ],
);

// Limits and counters

export const rateCounter = pgTable(
  "rate_counter",
  {
    limit_id: text().notNull(),
    subject_key: text().notNull(),
    window_start: at("window_start").notNull(),
    count: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.limit_id, t.subject_key, t.window_start] }),
    index("rate_counter_window").on(t.window_start),
    check("rate_counter_count", sql`${t.count} >= 0`),
  ],
);

export const modelUsage = pgTable(
  "model_usage",
  { number_key: text().notNull(), wib_date: day("wib_date").notNull(), calls: integer().notNull() },
  (t) => [primaryKey({ columns: [t.number_key, t.wib_date] }), check("model_usage_calls", sql`${t.calls} >= 0`)],
);

// Places: each import is a snapshot, one of them active

export const placeSnapshot = pgTable(
  "place_snapshot",
  {
    id: serial(),
    source: text().notNull(),
    data_date: day("data_date").notNull(),
    imported_at: at("imported_at").notNull(),
    village_count: integer().notNull(),
    regency_count: integer().notNull(),
    checksum: text().notNull(),
    active: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex("place_snapshot_one_active").on(t.active).where(sql`${t.active}`),
    check("place_snapshot_village_count", sql`${t.village_count} > 0`),
    check("place_snapshot_regency_count", sql`${t.regency_count} > 0`),
  ],
);

export const placeRegency = pgTable(
  "place_regency",
  {
    snapshot_id: bigint({ mode: "number" })
      .notNull()
      .references(() => placeSnapshot.id, { onDelete: "cascade" }),
    code: text().notNull(),
    name: text().notNull(),
    province_code: text().notNull(),
    province_name: text().notNull(),
    village_count: integer().notNull(),
    search_text: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshot_id, t.code] }),
    check("place_regency_code", sql.raw(`code ~ ${REGENCY_CODE}`)),
    check("place_regency_village_count", sql`${t.village_count} >= 0`),
  ],
);

export const placeDistrict = pgTable(
  "place_district",
  {
    snapshot_id: bigint({ mode: "number" }).notNull(),
    code: text().notNull(),
    name: text().notNull(),
    regency_code: text().notNull(),
    regency_name: text().notNull(),
    province_code: text().notNull(),
    province_name: text().notNull(),
    village_count: integer().notNull(),
    search_text: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshot_id, t.code] }),
    foreignKey({
      name: "place_district_regency_fk",
      columns: [t.snapshot_id, t.regency_code],
      foreignColumns: [placeRegency.snapshot_id, placeRegency.code],
    }).onDelete("cascade"),
    index("place_district_regency").on(t.snapshot_id, t.regency_code),
    check("place_district_code", sql.raw(`code ~ ${DISTRICT_CODE}`)),
    check("place_district_village_count", sql`${t.village_count} > 0`),
  ],
);

export const placeVillage = pgTable(
  "place_village",
  {
    snapshot_id: bigint({ mode: "number" })
      .notNull()
      .references(() => placeSnapshot.id, { onDelete: "cascade" }),
    code: text().notNull(),
    name: text().notNull(),
    district_name: text().notNull(),
    regency_code: text().notNull(),
    regency_name: text().notNull(),
    province_code: text().notNull(),
    province_name: text().notNull(),
    search_text: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshot_id, t.code] }),
    foreignKey({
      name: "place_village_regency_fk",
      columns: [t.snapshot_id, t.regency_code],
      foreignColumns: [placeRegency.snapshot_id, placeRegency.code],
    }).onDelete("cascade"),
    index("place_village_regency").on(t.snapshot_id, t.regency_code, t.name),
    check("place_village_code", sql.raw(`code ~ ${VILLAGE_CODE}`)),
  ],
);

export const placeVillageShape = pgTable(
  "place_village_shape",
  {
    snapshot_id: bigint({ mode: "number" }).notNull(),
    code: text().notNull(),
    min_lat: doublePrecision().notNull(),
    min_lon: doublePrecision().notNull(),
    max_lat: doublePrecision().notNull(),
    max_lon: doublePrecision().notNull(),
    centre_lat: doublePrecision().notNull(),
    centre_lon: doublePrecision().notNull(),
    rings: jsonb().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshot_id, t.code] }),
    foreignKey({
      name: "place_village_shape_village_fk",
      columns: [t.snapshot_id, t.code],
      foreignColumns: [placeVillage.snapshot_id, placeVillage.code],
    }).onDelete("cascade"),
    index("place_village_shape_centre").on(t.snapshot_id, t.centre_lat, t.centre_lon),
    check("place_village_shape_lat", sql`${t.max_lat} >= ${t.min_lat}`),
    check("place_village_shape_lon", sql`${t.max_lon} >= ${t.min_lon}`),
  ],
);

export const referenceFile = pgTable(
  "reference_file",
  {
    name: text().primaryKey(),
    // As the file names it: a date, or a version such as "versi 1".
    data_date: text().notNull(),
    source: text().notNull(),
    body: jsonb().notNull(),
    checksum: text().notNull(),
    imported_at: at("imported_at").notNull(),
  },
  () => [
    check(
      "reference_file_name",
      oneOf("name", ["bpbdContacts", "education", "responseActions", "forecast", "volcanoes", "facilityNumbers"]),
    ),
  ],
);

// Photos and videos

// A stored file whose row is gone, queued for the sweep to remove from the store.
export const photoRemoval = pgTable("photo_removal", {
  store_key: text().primaryKey(),
  queued_at: at("queued_at").notNull(),
});

export const draftPhoto = pgTable(
  "draft_photo",
  {
    id: text().primaryKey(),
    draft_id: text()
      .notNull()
      .references(() => reportDraft.id, { onDelete: "cascade" }),
    store_key: text().notNull().unique(),
    bytes: integer().notNull(),
    lat: doublePrecision(),
    lon: doublePrecision(),
    accuracy_m: doublePrecision(),
    badge: text().notNull(),
    far: boolean().notNull(),
    taken_at: at("taken_at"),
    time_source: text().notNull(),
    received_at: at("received_at").notNull(),
    version: integer(),
    gps_doubts: jsonb(),
  },
  (t) => [
    index("draft_photo_draft").on(t.draft_id, t.received_at),
    check("draft_photo_bytes", sql`${t.bytes} > 0`),
    check("draft_photo_lat", sql`${t.lat} is null or ${t.lat} between -90 and 90`),
    check("draft_photo_lon", sql`${t.lon} is null or ${t.lon} between -180 and 180`),
    check("draft_photo_accuracy", sql`${t.accuracy_m} is null or ${t.accuracy_m} >= 0`),
    check("draft_photo_badge", oneOf("badge", ["deviceGps", "photoData", "none"])),
    check("draft_photo_time_source", oneOf("time_source", ["photoData", "deviceGps", "upload"])),
    check("draft_photo_version", sql`${t.version} is null or ${t.version} >= 2`),
    check("draft_photo_point", sql`(${t.lat} is null) = (${t.lon} is null)`),
    check("draft_photo_badge_point", sql`(${t.badge} = 'none') = (${t.lat} is null)`),
    check("draft_photo_accuracy_gps", sql`${t.badge} = 'deviceGps' or ${t.accuracy_m} is null`),
  ],
);

export const videoUpload = pgTable(
  "video_upload",
  {
    id: text().primaryKey(),
    draft_id: text()
      .notNull()
      .references(() => reportDraft.id, { onDelete: "cascade" }),
    store_key: text().notNull().unique(),
    upload_id: text().notNull(),
    bytes: integer().notNull(),
    parts: jsonb().notNull().default({}),
    browser_seconds: doublePrecision(),
    started_at: at("started_at").notNull(),
    touched_at: at("touched_at").notNull(),
  },
  (t) => [
    index("video_upload_draft").on(t.draft_id),
    index("video_upload_touched").on(t.touched_at),
    check("video_upload_bytes", sql`${t.bytes} between 1000 and 31457280`),
    check("video_upload_browser_seconds", sql`${t.browser_seconds} is null or ${t.browser_seconds} >= 0`),
  ],
);

export const draftVideo = pgTable(
  "draft_video",
  {
    id: text().primaryKey(),
    draft_id: text()
      .notNull()
      .references(() => reportDraft.id, { onDelete: "cascade" }),
    store_key: text().notNull().unique(),
    bytes: integer().notNull(),
    container: text().notNull(),
    seconds: integer().notNull(),
    received_at: at("received_at").notNull(),
    made_at: at("made_at"),
    lat: doublePrecision(),
    lon: doublePrecision(),
  },
  (t) => [
    index("draft_video_draft").on(t.draft_id, t.received_at),
    check("draft_video_bytes", sql`${t.bytes} > 0`),
    check("draft_video_container", oneOf("container", ["mp4", "mov", "webm"])),
    check("draft_video_seconds", sql`${t.seconds} between 0 and 61`),
  ],
);

export const offlineSend = pgTable("offline_send", {
  client_id: text().primaryKey(),
  ticket_number: text()
    .notNull()
    .references(() => ticket.ticket_number),
  at: at("at").notNull(),
  kept: boolean().notNull().default(false),
  saved_at: at("saved_at"),
  late: boolean().notNull().default(false),
});

// Warnings sent to subscribed browsers

export const warningSubscription = pgTable(
  "warning_subscription",
  {
    endpoint: text().notNull(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    district_code: text().notNull(),
    regency_code: text().notNull(),
    district_name: text().notNull(),
    hazards: integer().notNull(),
    threshold: integer().notNull(),
    created_at: at("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.endpoint, t.district_code] }),
    index("warning_subscription_regency").on(t.regency_code),
    check(
      "warning_subscription_endpoint",
      sql`length(${t.endpoint}) between 20 and 1000 and ${t.endpoint} like 'https://%'`,
    ),
    check("warning_subscription_p256dh", sql`length(${t.p256dh}) between 80 and 100`),
    check("warning_subscription_auth", sql`length(${t.auth}) between 20 and 30`),
    check("warning_subscription_district_code", sql.raw(`district_code ~ ${DISTRICT_CODE}`)),
    check("warning_subscription_regency_code", sql.raw(`regency_code ~ ${REGENCY_CODE}`)),
    check("warning_subscription_hazards", sql`${t.hazards} between 1 and 15`),
    check("warning_subscription_threshold", sql`${t.threshold} between 1 and 3`),
  ],
);

export const warningSent = pgTable(
  "warning_sent",
  { regency_code: text().notNull(), hazard: text().notNull(), date: day("date").notNull(), level: integer().notNull() },
  (t) => [
    primaryKey({ columns: [t.regency_code, t.hazard, t.date] }),
    check("warning_sent_regency_code", sql.raw(`regency_code ~ ${REGENCY_CODE}`)),
    check("warning_sent_hazard", oneOf("hazard", WARNING_HAZARDS)),
    check("warning_sent_level", sql`${t.level} between 1 and 3`),
  ],
);

export const warningPause = pgTable("warning_pause", {
  id: serial(),
  paused: boolean().notNull(),
  staff_id: text().notNull(),
  staff_label: text().notNull(),
  at: at("at").notNull(),
});

export const warningDaily = pgTable(
  "warning_daily",
  {
    device: text().notNull(),
    regency_code: text().notNull(),
    hazard: text().notNull(),
    wib_date: day("wib_date").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.device, t.regency_code, t.hazard, t.wib_date] }),
    check("warning_daily_device", sql`length(${t.device}) = 16`),
    check("warning_daily_hazard", oneOf("hazard", WARNING_HAZARDS)),
  ],
);

// Missing people

export const missingPerson = pgTable(
  "missing_person",
  {
    id: text().primaryKey(),
    reporter_id: text()
      .notNull()
      .references(() => reporter.id),
    number_key: text().notNull(),
    owner_slot: text().notNull(),
    reporter_name: text(),
    village_code: text().notNull(),
    regency_code: text().notNull(),
    place: jsonb().notNull(),
    name: text(),
    nickname: text(),
    relation: text().notNull(),
    sex: text().notNull(),
    age: integer(),
    clothes: text(),
    marks: text(),
    last_seen_date: day("last_seen_date").notNull(),
    last_seen_time: text(),
    person_number: text(),
    contact_number: text(),
    wait_place: text(),
    photo_key: text(),
    status: text().notNull().default("open"),
    created_at: at("created_at").notNull(),
    closed_at: at("closed_at"),
    anonymised_at: at("anonymised_at"),
  },
  (t) => [
    index("missing_person_region").on(t.regency_code, t.created_at),
    index("missing_person_number").on(t.number_key, t.created_at),
    index("missing_person_owner").on(t.reporter_id, t.owner_slot, t.created_at),
    check("missing_person_age", sql`${t.age} is null or ${t.age} between 0 and 120`),
    check("missing_person_status", oneOf("status", ["open", "foundSafe", "foundDead", "toSar", "closed"])),
  ],
);

export const missingPersonHistory = pgTable(
  "missing_person_history",
  {
    id: serial(),
    missing_id: text()
      .notNull()
      .references(() => missingPerson.id),
    from_status: text(),
    to_status: text().notNull(),
    note: text(),
    staff_id: text(),
    staff_label: text(),
    at: at("at").notNull(),
  },
  (t) => [index("missing_person_history_missing").on(t.missing_id, t.at)],
);

// Comments on the public feed, and the figures read from them

export const feedComment = pgTable(
  "feed_comment",
  {
    id: text().primaryKey(),
    card_id: text().notNull(),
    author_key: text().notNull(),
    text: text().notNull(),
    status: text().notNull().default("shown"),
    reports: integer().notNull().default(0),
    created_at: at("created_at").notNull(),
  },
  (t) => [
    index("feed_comment_card").on(t.card_id, t.created_at),
    index("feed_comment_author").on(t.author_key, t.status),
    check("feed_comment_id", sql`length(${t.id}) = 16`),
    check("feed_comment_card_id", sql`length(${t.card_id}) = 16`),
    check("feed_comment_text", sql`length(${t.text}) between 2 and 500`),
    check("feed_comment_status", oneOf("status", ["shown", "reported", "hidden"])),
    check("feed_comment_reports", sql`${t.reports} >= 0`),
  ],
);

export const feedCommentReport = pgTable(
  "feed_comment_report",
  {
    comment_id: text()
      .notNull()
      .references(() => feedComment.id),
    reporter_key: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.comment_id, t.reporter_key] })],
);

export const feedCommentFigure = pgTable(
  "feed_comment_figure",
  {
    id: serial(),
    comment_id: text()
      .notNull()
      .references(() => feedComment.id),
    figure: text().notNull(),
    value: integer().notNull(),
    quote: text().notNull(),
    status: text().notNull().default("proposed"),
  },
  (t) => [
    unique().on(t.comment_id, t.figure),
    check(
      "feed_comment_figure_figure",
      oneOf("figure", ["dead", "missing", "injured", "displaced", "houses", "flooded"]),
    ),
    check("feed_comment_figure_value", sql`${t.value} between 0 and 100000`),
    check("feed_comment_figure_quote", sql`length(${t.quote}) between 1 and 200`),
    check("feed_comment_figure_status", oneOf("status", ["proposed", "accepted", "rejected"])),
  ],
);

export const feedCommentDecision = pgTable(
  "feed_comment_decision",
  {
    id: serial(),
    comment_id: text()
      .notNull()
      .references(() => feedComment.id),
    figure_id: bigint({ mode: "number" }).references(() => feedCommentFigure.id),
    action: text().notNull(),
    ticket_number: text(),
    field_id: text(),
    reason: text(),
    staff_id: text().notNull(),
    staff_label: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    index("feed_comment_decision_comment").on(t.comment_id, t.at),
    index("feed_comment_decision_figure").on(t.figure_id),
    check("feed_comment_decision_action", oneOf("action", ["accept", "reject", "hide", "show"])),
    check("feed_comment_decision_reason", sql`${t.reason} is null or length(${t.reason}) <= 300`),
    check("feed_comment_decision_figure", sql`(${t.action} in ('accept', 'reject')) = (${t.figure_id} is not null)`),
  ],
);

// Case files: what a BPBD team records on the ground, and who may read it

export const caseFile = pgTable(
  "case_file",
  {
    id: text().primaryKey(),
    ticket_number: text()
      .notNull()
      .unique()
      .references(() => ticket.ticket_number),
    regency_code: text().notNull(),
    status: text().notNull().default("open"),
    fields: jsonb().notNull().default({}),
    nil: jsonb().notNull().default([]),
    revision: integer().notNull().default(0),
    opened_by: text().notNull(),
    opened_at: at("opened_at").notNull(),
    // When BNPB accepted its closing: five years of personal data run from here (D23).
    accepted_at: at("accepted_at"),
    erased_at: at("erased_at"),
  },
  (t) => [
    index("case_file_regency").on(t.regency_code, t.status),
    check("case_file_id", sql`length(${t.id}) = 16`),
    check("case_file_status", oneOf("status", ["open", "proposed", "done", "doneNoted"])),
  ],
);

export const caseMember = pgTable(
  "case_member",
  {
    id: text().primaryKey(),
    file_id: text()
      .notNull()
      .references(() => caseFile.id),
    name: text().notNull(),
    number: text().notNull(),
    // SHA-256 of the one-time link; cleared once it is exchanged.
    link_hash: text().unique(),
    link_expires_at: at("link_expires_at"),
    // SHA-256 of the member's own cookie.
    session_hash: text().unique(),
    session_expires_at: at("session_expires_at"),
    added_by: text().notNull(),
    added_at: at("added_at").notNull(),
    removed_at: at("removed_at"),
  },
  (t) => [
    index("case_member_file").on(t.file_id),
    check("case_member_id", sql`length(${t.id}) = 16`),
    check("case_member_name", sql`length(${t.name}) between 2 and 80`),
  ],
);

export const caseRecord = pgTable(
  "case_record",
  {
    id: text().primaryKey(),
    file_id: text()
      .notNull()
      .references(() => caseFile.id),
    kind: text().notNull(),
    seq: integer().notNull(),
    data: jsonb().notNull(),
    personal: jsonb().notNull(),
    lat: doublePrecision(),
    lon: doublePrecision(),
    cancelled_reason: text(),
    // The phone's own id for a save made with no signal: sent again, it is one record.
    client_id: text(),
    revision: integer().notNull().default(0),
    by_label: text().notNull(),
    created_at: at("created_at").notNull(),
    updated_at: at("updated_at").notNull(),
  },
  (t) => [
    unique().on(t.file_id, t.kind, t.seq),
    unique().on(t.file_id, t.client_id),
    check("case_record_id", sql`length(${t.id}) = 16`),
    check(
      "case_record_kind",
      oneOf("kind", ["house", "infrastructure", "shelter", "evacuee", "victim", "business", "need"]),
    ),
  ],
);

export const caseMedia = pgTable(
  "case_media",
  {
    id: text().primaryKey(),
    record_id: text()
      .notNull()
      .references(() => caseRecord.id),
    file_id: text()
      .notNull()
      .references(() => caseFile.id),
    kind: text().notNull(),
    object_key: text().notNull(),
    lat: doublePrecision(),
    lon: doublePrecision(),
    badge: text().notNull(),
    taken_at: at("taken_at"),
    by_label: text().notNull(),
    at: at("at").notNull(),
    erased_at: at("erased_at"),
    seconds: doublePrecision(),
    container: text(),
  },
  (t) => [
    index("case_media_record").on(t.record_id),
    index("case_media_file").on(t.file_id),
    check("case_media_kind", oneOf("kind", ["photo", "face", "video"])),
    check("case_media_badge", oneOf("badge", ["gps", "exif", "none"])),
  ],
);

export const caseTrail = pgTable(
  "case_trail",
  {
    id: serial(),
    file_id: text()
      .notNull()
      .references(() => caseFile.id),
    record_id: text(),
    action: text().notNull(),
    detail: jsonb(),
    by_label: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    index("case_trail_file").on(t.file_id, t.at),
    check(
      "case_trail_action",
      oneOf("action", [
        "open",
        "add",
        "change",
        "cancel",
        "media",
        "nil",
        "fields",
        "memberAdd",
        "memberRemove",
        "memberLink",
        "close",
        "accept",
        "reopen",
        "erase",
      ]),
    ),
  ],
);

export const caseAccess = pgTable(
  "case_access",
  {
    id: serial(),
    file_id: text()
      .notNull()
      .references(() => caseFile.id),
    record_id: text(),
    action: text().notNull(),
    who_id: text().notNull(),
    who_label: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    index("case_access_file").on(t.file_id, t.at),
    check("case_access_action", oneOf("action", ["open", "reveal", "media"])),
  ],
);

export const caseVersion = pgTable(
  "case_version",
  {
    file_id: text()
      .notNull()
      .references(() => caseFile.id),
    version: integer().notNull(),
    // The sealed JSON as written, byte for byte: the fingerprint is of this text.
    body: text().notNull(),
    fingerprint: text().notNull(),
    sealed_by: text().notNull(),
    at: at("at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.file_id, t.version] }),
    check("case_version_version", sql`${t.version} >= 1`),
    check("case_version_fingerprint", sql`length(${t.fingerprint}) = 64`),
  ],
);

export const caseVideoUpload = pgTable(
  "case_video_upload",
  {
    id: text().primaryKey(),
    file_id: text()
      .notNull()
      .references(() => caseFile.id),
    record_id: text()
      .notNull()
      .references(() => caseRecord.id),
    store_key: text().notNull().unique(),
    upload_id: text().notNull(),
    bytes: integer().notNull(),
    parts: jsonb().notNull().default({}),
    browser_seconds: doublePrecision(),
    started_at: at("started_at").notNull(),
    touched_at: at("touched_at").notNull(),
  },
  (t) => [
    index("case_video_upload_record").on(t.record_id),
    index("case_video_upload_file").on(t.file_id),
    index("case_video_upload_touched").on(t.touched_at),
    check("case_video_upload_bytes", sql`${t.bytes} between 1000 and 31457280`),
    check("case_video_upload_browser_seconds", sql`${t.browser_seconds} is null or ${t.browser_seconds} >= 0`),
  ],
);

// Staff who signed in through auth (centurisk97-auth), as their last sign-in described them. The id
// is auth's subject; the role and region come from their memberships claim. BPBD officers with a
// phone are the officers a BNPB officer may call about a report in their region.
export const staffMember = pgTable(
  "staff_member",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    position: text().notNull(),
    agency: text().notNull(),
    phone: text(),
    role: text().notNull(),
    scope_level: text().notNull(),
    scope_code: text(),
    signed_in_at: at("signed_in_at").notNull(),
  },
  (t) => [
    index("staff_member_scope").on(t.role, t.scope_level, t.scope_code),
    check("staff_member_id", sql`length(${t.id}) between 1 and 64`),
    check("staff_member_role", oneOf("role", STAFF_ROLES)),
    check("staff_member_scope_level", oneOf("scope_level", SCOPE_LEVELS)),
    check("staff_member_scope", sql`(${t.scope_level} = 'national') = (${t.scope_code} is null)`),
  ],
);

// A desk sign-in. Only a fingerprint of the cookie's token is kept.
export const staffSession = pgTable(
  "staff_session",
  {
    token_hash: text().primaryKey(),
    staff_id: text()
      .notNull()
      .references(() => staffMember.id, { onDelete: "cascade" }),
    expires_at: at("expires_at").notNull(),
  },
  (t) => [index("staff_session_expiry").on(t.expires_at), index("staff_session_staff").on(t.staff_id)],
);
