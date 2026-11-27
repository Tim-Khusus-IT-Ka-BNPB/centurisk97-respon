import { type CaseKind, type CaseValues, DAMAGE, SERVICES, VITAL } from "./caseSpec";
import { distanceKm, type Point } from "./geo";
import { HOUR_MS } from "./time";

// What the records of a follow-up file add up to (upstream ALGORITMA 3 to 5 and 7): flags that
// never refuse a save, the totals counted from the list, never typed (D5), the nil marks that tell
// none from not yet recorded (D15), the state the event closes in (D13), and the sealed version
// that carries no personal value (D14).

export type CaseRecord = {
  readonly id: string;
  readonly kind: CaseKind;
  readonly seq: number;
  readonly data: CaseValues;
  readonly personal: CaseValues;
  readonly point: Point | null;
  readonly cancelled: boolean;
};

export type CaseMedia = {
  readonly point: Point | null;
  readonly badge: "gps" | "exif" | "none";
  readonly takenAtMs: number | null;
};

// HYPOTHESIS of upstream's design, changed here without a migration.
export const FLAG_LIMITS = { farPhotoM: 500, oldPhotoHours: 72, samePointM: 10 } as const;
// Records of people and needs have no point of their own.
const UNPLACED: readonly CaseKind[] = ["evacuee", "victim", "need"];

// The record's point: typed, else its first photo's GPS point, else its first photo's EXIF point.
export function recordPoint(typed: Point | null, media: readonly CaseMedia[]): Point | null {
  const from = (badge: "gps" | "exif") => media.find((one) => one.badge === badge && one.point !== null)?.point;
  return typed ?? from("gps") ?? from("exif") ?? null;
}

export type Flag = "noPoint" | "farPhoto" | "oldPhoto" | "samePoint" | "sameNik" | "outsideRegency";

// What looks wrong about a record, shown beside it: never a refusal (ALGORITMA 3). Two records of
// people are compared only within one kind and one file (D16).
export function flagsOf(
  record: CaseRecord,
  context: {
    readonly others: readonly CaseRecord[];
    readonly media: readonly CaseMedia[];
    readonly eventMs: number | null;
    readonly inRegency: (point: Point) => boolean;
  },
): Flag[] {
  const flags: Flag[] = [];
  const point = record.point;
  const kin = context.others.filter((one) => one.id !== record.id && one.kind === record.kind && !one.cancelled);
  if (point === null && !UNPLACED.includes(record.kind)) flags.push("noPoint");
  const metres = (from: Point, to: Point) => distanceKm(from, to) * 1000;
  if (
    point !== null &&
    // Stryker disable next-line EqualityOperator: a distance is never exactly the limit
    context.media.some((one) => one.point !== null && metres(point, one.point) > FLAG_LIMITS.farPhotoM)
  )
    flags.push("farPhoto");
  // With no event time, nothing is too old.
  const oldest = (context.eventMs ?? Number.NEGATIVE_INFINITY) - FLAG_LIMITS.oldPhotoHours * HOUR_MS;
  if (context.media.some((one) => one.takenAtMs !== null && one.takenAtMs < oldest)) flags.push("oldPhoto");
  if (
    point !== null &&
    (record.kind === "house" || record.kind === "infrastructure") &&
    // Stryker disable next-line EqualityOperator: a distance is never exactly the limit
    kin.some((one) => one.point !== null && metres(point, one.point) <= FLAG_LIMITS.samePointM)
  )
    flags.push("samePoint");
  // Only evacuees and victims hold a NIK of their own, so people are compared within their kind (D16).
  const nik = record.personal.nik;
  if (nik !== undefined && kin.some((one) => one.personal.nik === nik)) flags.push("sameNik");
  if (point !== null && !context.inRegency(point)) flags.push("outsideRegency");
  return flags;
}

const LEVEL: Readonly<Record<(typeof DAMAGE)[number], string>> = {
  heavy: "Heavy",
  moderate: "Moderate",
  light: "Light",
};
const CORE = [
  "dead",
  "missing",
  "injured",
  "displaced",
  "housesHeavy",
  "housesModerate",
  "housesLight",
  "housesFlooded",
] as const;
// The only names that may be marked nil; any other is ignored.
export const NIL_METRICS: ReadonlySet<string> = new Set([
  ...CORE,
  "infrastructureCut",
  "roadKm",
  ...DAMAGE.map((level) => `bridge${LEVEL[level]}`),
  ...VITAL.map((one) => `${one}Units`),
  ...SERVICES.flatMap((one) => DAMAGE.map((level) => `${one}${LEVEL[level]}`)),
]);

const live = (records: readonly CaseRecord[]) => records.filter((one) => !one.cancelled);
// Only an evacuee has an entry day; with no day nobody is counted.
const displacedOn = (record: CaseRecord, day: string | null) =>
  (record.data.entered as string) <= (day as string) &&
  (record.data.left === undefined || (record.data.left as string) > (day as string));

// Each metric's records (ALGORITMA 4).
function metricSets(records: readonly CaseRecord[], day: string | null): Map<string, CaseRecord[]> {
  const sets = new Map<string, CaseRecord[]>();
  const add = (metric: string, record: CaseRecord) => sets.set(metric, [...(sets.get(metric) ?? []), record]);
  for (const record of live(records)) {
    const data = record.data;
    const level = LEVEL[data.damage as keyof typeof LEVEL];
    switch (record.kind) {
      case "house":
        if (data.damage !== "none") add(`houses${level}`, record);
        if (data.flooded === true) add("housesFlooded", record);
        break;
      case "victim":
        if (data.status === "dead" || data.search === "foundDead") add("dead", record);
        else if (data.status === "missing" && data.search === "searching") add("missing", record);
        else if (data.status === "badlyHurt" || data.status === "lightlyHurt") add("injured", record);
        break;
      case "evacuee":
        if (displacedOn(record, day)) add("displaced", record);
        break;
      case "infrastructure": {
        const type = data.type as string;
        if (type === "bridge") add(`bridge${level}`, record);
        else if (type === "road") add("roadKm", record);
        else if (VITAL.some((one) => one === type)) add(`${type}Units`, record);
        else if (SERVICES.some((one) => one === type)) add(`${type}${level}`, record);
        if (data.function === "cut") add("infrastructureCut", record);
        break;
      }
    }
  }
  return sets;
}

// Records whose metric is 0 from the list itself: the missing all found, the evacuees all gone home,
// no infrastructure cut (D13).
// Who is displaced is known only on a day. Only victims have a status.
const covered = (records: readonly CaseRecord[], dated: boolean): readonly string[] => {
  const all = live(records);
  return [
    ...(all.some((one) => one.data.status === "missing") ? ["missing"] : []),
    ...(dated && all.some((one) => one.kind === "evacuee") ? ["displaced"] : []),
    ...(all.some((one) => one.kind === "infrastructure") ? ["infrastructureCut"] : []),
  ];
};

// Each group up to its last year of age.
const AGE_GROUPS = [
  ["Child", 17],
  ["Adult", 59],
  ["Elderly", 200],
] as const;

export type Recap = Readonly<Record<string, number | null>>;

// Each metric: its count when it has records, 0 when marked nil or ended in the list, else null:
// not yet recorded, never 0 (D15). Who is displaced needs a day.
export function recapOf(records: readonly CaseRecord[], nil: ReadonlySet<string>, day: string | null): Recap {
  const sets = metricSets(records, day);
  const ended = new Set(covered(records, day !== null));
  const marked = new Set([...nil].filter((one) => NIL_METRICS.has(one) && (one !== "displaced" || day !== null)));
  const recap: Record<string, number | null> = {};
  for (const metric of new Set([...CORE, "infrastructureCut", ...sets.keys(), ...marked])) {
    const found = sets.get(metric) ?? [];
    recap[metric] =
      found.length === 0
        ? marked.has(metric) || ended.has(metric)
          ? 0
          : null
        : metric === "roadKm"
          ? Math.round(found.reduce((sum, one) => sum + ((one.data.lengthM as number | undefined) ?? 0), 0)) / 1000
          : found.length;
  }
  // By age group and sex, for the records with both.
  for (const metric of ["dead", "missing", "injured", "displaced"])
    for (const record of sets.get(metric) ?? []) {
      const age = record.data.age as number;
      const group = (AGE_GROUPS.find(([, last]) => age <= last) as (typeof AGE_GROUPS)[number])[0];
      const key = `${metric}${group}${record.data.sex === "male" ? "Male" : "Female"}`;
      recap[key] = (recap[key] ?? 0) + 1;
    }
  return recap;
}

// The metrics that have records, which can no longer be marked nil; a new record drops its nil.
export function metricsWithRecords(records: readonly CaseRecord[]): ReadonlySet<string> {
  return new Set([...metricSets(records, null).keys(), ...covered(records, true)]);
}

export const dropFilledNil = (nil: ReadonlySet<string>, records: readonly CaseRecord[]): ReadonlySet<string> => {
  const filled = metricsWithRecords(records);
  return new Set([...nil].filter((one) => !filled.has(one)));
};

const ENDING = ["missing", "displaced", "infrastructureCut"] as const;

export type FinalState = {
  readonly status: "done" | "doneNoted";
  // What keeps it open: a count over 0, or not yet recorded.
  readonly reasons: readonly { readonly metric: (typeof ENDING)[number]; readonly value: number | null }[];
  readonly notRecorded: readonly string[];
};

// How the event closes: done only when no one is missing, no one displaced and nothing cut, each of
// them known (D13); any other metric not recorded is listed, not held against it (Q7).
export function finalState(recap: Recap): FinalState {
  const reasons = ENDING.filter((metric) => recap[metric] !== 0).map((metric) => ({
    metric,
    value: recap[metric] ?? null,
  }));
  const notRecorded = Object.keys(recap).filter(
    (metric) => recap[metric] === null && !ENDING.some((one) => one === metric),
  );
  return { status: reasons.length === 0 ? "done" : "doneNoted", reasons, notRecorded };
}

// JSON with its keys in order, so one content is always one text.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

// The sealed version's content: the totals, the final state and the closing, with each record by
// its fingerprint only, keyed by the caller's secret so no number or NIK can be guessed from it (D14).
export async function sealedBody(
  file: { readonly id: string; readonly ticketNumber: string; readonly regencyCode: string },
  records: readonly CaseRecord[],
  sealed: { readonly recap: Recap; readonly final: FinalState; readonly closing: CaseValues },
  fingerprint: (text: string) => Promise<string>,
): Promise<string> {
  const listed = await Promise.all(
    live(records)
      .toSorted((a, b) => a.id.localeCompare(b.id))
      .map(async (one) => ({
        id: one.id,
        kind: one.kind,
        seq: one.seq,
        fingerprint: await fingerprint(canonical({ data: one.data, personal: one.personal })),
      })),
  );
  return canonical({
    file: { id: file.id, ticketNumber: file.ticketNumber, regencyCode: file.regencyCode },
    recap: sealed.recap,
    final: sealed.final,
    closing: sealed.closing,
    records: listed,
  });
}
