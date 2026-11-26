import { referenceFile } from "../adapters/d1/reports";
import { keepSent, latestPause, phonesOf, sentLevels, stopWarnings } from "../adapters/d1/warnings";
import { copy } from "../copy";
import { localDate } from "../domain/eventTime";
import { checkForecastFile } from "../domain/forecast";
import { type Rise, riseFor, risenWarnings } from "../domain/warnings";
import { pushRequest } from "../platform/webPush";
import type { ServiceBindings } from "./bindings";

// Hands one request to a push service; the Worker's own fetch outside tests.
export type PushSend = (request: Request) => Promise<Response>;

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

// The scheduled send (M07 TASK-003): each rise of the outlook to the phones that asked for it.
// Nothing goes while paused, with no push keys, or with no fresh outlook to read.
export async function sendWarnings(
  bindings: Pick<ServiceBindings, "db" | "settings" | "clock">,
  send: PushSend,
): Promise<Counts> {
  const { db, settings, clock } = bindings;
  const counts: Counts = { sent: 0, gone: 0, failed: 0 };
  const keys = settings.push;
  if (keys === null || (await latestPause(db))?.paused === 1) return counts;
  const file = checkForecastFile(await referenceFile(db, "forecast"));
  if (file === null) return counts;
  const nowMs = clock.now();
  const done: Rise[] = [];
  for (const [regencyCode, rises] of Map.groupBy(
    risenWarnings(file, await sentLevels(db), nowMs),
    (rise) => rise.regencyCode,
  )) {
    if (counts.sent + counts.failed >= PER_RUN) break;
    for (const phone of await phonesOf(db, regencyCode)) {
      const rise = riseFor(rises, phone.hazards, phone.threshold);
      if (rise === null) continue;
      const answer = await send(await pushRequest(keys, phone, JSON.stringify(messageOf(rise)), nowMs)).catch(
        () => null,
      );
      if (answer?.ok) counts.sent += 1;
      else if (answer?.status === 404 || answer?.status === 410) {
        counts.gone += 1;
        await stopWarnings(db, phone.endpoint);
      } else counts.failed += 1;
    }
    done.push(...rises);
  }
  await keepSent(db, done, localDate(nowMs, "WIB"));
  return counts;
}
