import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { DeskEmergencies, DeskEmergency } from "../../../../src/contract/desk";
import { alarmReady, alarmSound, askForAlarm, notify } from "../../../lib/alarm";
import { getJson } from "../../../lib/clientApi";
import { hazardKey } from "../../../lib/hazardLabel";
import { useHydrated } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { Icon } from "../../atoms/Icon";
import { whenShort } from "./parts";

const REFRESH_MS = 20_000;

// What nobody has opened, read again every 20 seconds, hidden tabs included: an alarm waits for no
// one to look. A read that fails keeps what was there.
function useEmergencies(initial: readonly DeskEmergency[]): readonly DeskEmergency[] {
  const [read, setRead] = useState<readonly DeskEmergency[] | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/lapor/desk/emergencies");
        if (!response.ok) return;
        const { emergencies } = (await response.json()) as DeskEmergencies;
        if (live) setRead(emergencies);
      } catch {
        // No connection: the next read is 20 seconds away.
      }
    }, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  // A page moved to, or a report opened, brings its own newer list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the server's list takes over when it changes.
  useEffect(() => setRead(null), [initial]);
  return read ?? initial;
}

// Emergencies on top of every desk page until an officer opens them, with a sound and a
// notification for each new one once the officer has turned them on.
export function EmergencyBanner({ initial }: { readonly initial: readonly DeskEmergency[] }) {
  const t = useText();
  const hydrated = useHydrated();
  const emergencies = useEmergencies(initial);
  const known = useRef(new Set(initial.map((one) => one.ticketNumber)));
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(alarmReady()), []);
  useEffect(() => {
    const fresh = emergencies.filter((one) => !known.current.has(one.ticketNumber));
    known.current = new Set(emergencies.map((one) => one.ticketNumber));
    if (fresh.length === 0) return;
    alarmSound();
    for (const one of fresh)
      notify(
        t("desk.emergency.notice"),
        t("desk.emergency.place", { village: one.villageName, regency: one.regencyName }),
        `/lapor/meja/${one.ticketNumber}`,
      );
  }, [emergencies, t]);
  if (emergencies.length === 0) return null;
  return (
    <section
      aria-labelledby="desk-emergency"
      className="sticky top-14 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 bg-signal px-4 py-2.5 text-on-signal md:px-6 lg:top-0 lg:flex-nowrap lg:py-2"
    >
      <h2
        id="desk-emergency"
        className="inline-flex min-w-0 flex-1 items-center gap-2 font-bold lg:flex-none"
        role="alert"
      >
        <Icon name="triangleAlert" className="size-5" />
        {t("desk.emergency.title", { count: emergencies.length })}
      </h2>
      <ul className="fade-x order-last flex w-full min-w-0 gap-2 overflow-x-auto lg:order-none lg:w-auto lg:flex-1">
        {emergencies.map((one) => (
          <li key={one.ticketNumber} className="flex max-w-[78vw] shrink-0 lg:max-w-none">
            <Link
              to={`/lapor/meja/${one.ticketNumber}`}
              className="flex min-h-target-min min-w-0 flex-col justify-center rounded-control bg-signal-deep px-3 py-1.5 text-meta leading-snug text-on-signal no-underline hover:bg-[color-mix(in_oklab,var(--signal-deep),var(--on-signal)_14%)]"
            >
              <span className="truncate font-bold">
                {t(hazardKey(one.hazardType))}
                {", "}
                {t("desk.emergency.place", { village: one.villageName, regency: one.regencyName })}
              </span>
              <span className="truncate tabular-nums first-letter:uppercase">
                {t(`desk.emergency.victims.${one.victims}`)}, {whenShort(t, one.sentAt)}, {one.ticketNumber}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hydrated && !ready ? (
        <button
          type="button"
          title={t("desk.emergency.turnOn")}
          className="ms-auto inline-flex min-h-target-min min-w-target-min shrink-0 items-center justify-center gap-2 rounded-control px-3 text-meta font-semibold hover:bg-signal-deep lg:ms-0"
          onClick={async () => setReady(await askForAlarm())}
        >
          <Icon name="bell" className="size-5" />
          <span className="max-2xl:sr-only">{t("desk.emergency.turnOn")}</span>
        </button>
      ) : null}
    </section>
  );
}
