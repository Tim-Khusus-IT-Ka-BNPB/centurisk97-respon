import { referenceFile } from "../adapters/d1/reports";
import {
  keepSent,
  latestPause,
  phonesOf,
  sentLevels,
  stopWarnings,
  toldDaily,
  toldToday,
} from "../adapters/d1/warnings";
import { copy } from "../copy";
import { localDate } from "../domain/eventTime";
import { checkForecastFile } from "../domain/forecast";
import { mergedRises, type Rise, riseFor, risenWarnings, statusRises } from "../domain/warnings";
import { sha256Hex } from "../platform/keys";
import { pushRequest } from "../platform/webPush";
import type { ServiceBindings } from "./bindings";

// Hands one request to a push service; the Worker's own fetch outside tests.
export type PushSend = (request: Request) => Promise<Response>;

// Upstream's hourly status file (DP-13), as its bucket holds it; null where there is none, as on
// staging, which has no upstream bucket.
export type StatusRead = () => Promise<unknown>;
const noStatus: StatusRead = async () => null;

// Phones told in one scheduled run; the regencies left wait for the next run, 15 minutes on.
export const PER_RUN = 200;

const dayName = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// Landslide, wind and smoke models have not passed their back-test: their warnings still go, labelled
// as a hypothesis (upstream KI-01, KEPUTUSAN-KEMAMPUAN Q1). Flood has passed.
const HYPOTHESIS: ReadonlySet<string> = new Set(["LSR", "CEX", "ASP"]);

// What the phone shows, and the page it opens. Always says it is our outlook, not BMKG's (Q2).
export function messageOf(rise: Rise) {
  const hypothesis = HYPOTHESIS.has(rise.hazard);
  const title = copy.format("warn.push.title", {
    level: copy.text(`info.level.${rise.level}`),
    hazard: copy.text(`warn.push.hazard.${rise.hazard}`),
    regency: rise.regencyName,
  });
  return {
    title: hypothesis ? copy.format("warn.push.hypothesisTitle", { title }) : title,
    body: copy.format(hypothesis ? "warn.push.hypothesisBody" : "warn.push.body", {
      day: dayName.format(Date.parse(rise.date)),
    }),
    url: `/lapor/info?kab=${rise.regencyCode}`,
  };
}

type Counts = { sent: number; gone: number; failed: number };

// The scheduled send (M07 TASK-003): each rise of the outlook, and of upstream's status file
// (DP-13), to the phones that asked for it, a phone told at most once a day of a regency's hazard.
// Nothing goes while paused, with no push keys, or with no fresh outlook to read.
export async function sendWarnings(
  bindings: Pick<ServiceBindings, "db" | "settings" | "clock">,
  send: PushSend,
  readStatus: StatusRead = noStatus,
): Promise<Counts> {
  const { db, settings, clock } = bindings;
  const counts: Counts = { sent: 0, gone: 0, failed: 0 };
  const keys = settings.push;
  if (keys === null || (await latestPause(db))?.paused === 1) return counts;
  const file = checkForecastFile(await referenceFile(db, "forecast"));
  if (file === null) return counts;
  const nowMs = clock.now();
  const today = localDate(nowMs, "WIB");
  const sent = await sentLevels(db);
  const names = new Map(file.kab.map((regency) => [regency.id, regency.nama]));
  const status = await readStatus().catch(() => null);
  const done: Rise[] = [];
  for (const [regencyCode, rises] of Map.groupBy(
    mergedRises(risenWarnings(file, sent, nowMs), statusRises(status, names, sent, nowMs)),
    (rise) => rise.regencyCode,
  )) {
    if (counts.sent + counts.failed >= PER_RUN) break;
    const told = await toldToday(db, regencyCode, today);
    for (const phone of await phonesOf(db, regencyCode)) {
      const device = (await sha256Hex(phone.endpoint)).slice(0, 16);
      const fresh = rises.filter((rise) => !told.has(`${device}|${rise.hazard}`));
      const rise = riseFor(fresh, phone.hazards, phone.threshold);
      if (rise === null) continue;
      const answer = await send(await pushRequest(keys, phone, JSON.stringify(messageOf(rise)), nowMs)).catch(
        () => null,
      );
      if (answer?.ok) {
        counts.sent += 1;
        await toldDaily(db, { device, regencyCode, hazard: rise.hazard }, today);
      } else if (answer?.status === 404 || answer?.status === 410) {
        counts.gone += 1;
        await stopWarnings(db, phone.endpoint);
      } else counts.failed += 1;
    }
    done.push(...rises);
  }
  await keepSent(db, done, today);
  return counts;
}
