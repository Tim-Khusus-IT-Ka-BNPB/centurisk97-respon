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

export const subscriberCount = async (db: Database) =>
  (await row<{ n: number }>(db, sql`select count(distinct endpoint) as n from warning_subscription`))?.n ?? 0;

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
