import { atomically, type Database, row, rows, run, sql } from "../../platform/database";

export type SubscriptionRow = {
  readonly district_code: string;
  readonly district_name: string;
  readonly hazards: number;
  readonly threshold: number;
};

export type WarningChoice = {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly districts: readonly { readonly code: string; readonly name: string }[];
  readonly hazards: number;
  readonly threshold: number;
};

export const subscriptionsOf = (db: Database, endpoint: string) =>
  rows<SubscriptionRow>(
    db,
    sql`select district_code, district_name, hazards, threshold from warning_subscription
      where endpoint = ${endpoint} order by district_code`,
  );

// A count always answers one row.
export const subscriberCount = async (db: Database) =>
  ((await row(db, sql`select count(distinct endpoint) as n from warning_subscription`)) as { n: number }).n;

// The phone's whole choice replaces what it had: districts left out are dropped.
export async function keepChoice(db: Database, choice: WarningChoice, at: Date): Promise<void> {
  const codes = JSON.stringify(choice.districts.map((district) => district.code));
  await atomically(db, [
    sql`delete from warning_subscription where endpoint = ${choice.endpoint}
      and district_code not in (select value from json_each(${codes}))`,
    ...choice.districts.map(
      (district) => sql`insert into warning_subscription (endpoint, p256dh, auth, district_code, regency_code,
          district_name, hazards, threshold, created_at)
        values (${choice.endpoint}, ${choice.p256dh}, ${choice.auth}, ${district.code}, ${district.code.slice(0, 5)},
          ${district.name}, ${choice.hazards}, ${choice.threshold}, ${at})
        on conflict (endpoint, district_code) do update set p256dh = excluded.p256dh, auth = excluded.auth,
          district_name = excluded.district_name, hazards = excluded.hazards, threshold = excluded.threshold`,
    ),
  ]);
}

export const stopWarnings = (db: Database, endpoint: string) =>
  run(db, sql`delete from warning_subscription where endpoint = ${endpoint}`);

export type TargetRow = {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly hazards: number;
  readonly threshold: number;
};

// Each phone warned of a regency, once, however many of its districts it picked.
export const phonesOf = (db: Database, regencyCode: string) =>
  rows<TargetRow>(
    db,
    sql`select endpoint, max(p256dh) as p256dh, max(auth) as auth, max(hazards) as hazards, min(threshold) as threshold
      from warning_subscription where regency_code = ${regencyCode} group by endpoint`,
  );

export async function sentLevels(db: Database): Promise<Map<string, number>> {
  const found = await rows<{ regency_code: string; hazard: string; date: string; level: number }>(
    db,
    sql`select regency_code, hazard, date, level from warning_sent`,
  );
  return new Map(found.map((one) => [`${one.regency_code}|${one.hazard}|${one.date}`, one.level]));
}

// Kept as sent, the higher level winning; days past are dropped.
export async function keepSent(
  db: Database,
  sent: readonly { regencyCode: string; hazard: string; date: string; level: number }[],
  today: string,
): Promise<void> {
  await atomically(db, [
    sql`delete from warning_sent where date < ${today}`,
    ...sent.map(
      (one) => sql`insert into warning_sent (regency_code, hazard, date, level)
        values (${one.regencyCode}, ${one.hazard}, ${one.date}, ${one.level})
        on conflict (regency_code, hazard, date) do update set level = max(level, excluded.level)`,
    ),
  ]);
}

export type PauseRow = { readonly paused: number; readonly staff_label: string; readonly at: string };

export const latestPause = (db: Database) =>
  row<PauseRow>(db, sql`select paused, staff_label, at from warning_pause order by id desc limit 1`);

export const setPause = (
  db: Database,
  paused: boolean,
  staff: { readonly staffId: string; readonly label: string },
  at: Date,
) =>
  run(
    db,
    sql`insert into warning_pause (paused, staff_id, staff_label, at)
      values (${paused}, ${staff.staffId}, ${staff.label}, ${at})`,
  );
