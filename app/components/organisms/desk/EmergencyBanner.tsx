import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { DeskEmergencies, DeskEmergency } from "../../../../src/contract/desk";
import { alarmReady, alarmSound, askForAlarm, notify } from "../../../lib/alarm";
import { useHydrated } from "../../../lib/hooks";
import { useText } from "../../../lib/text";
import { Icon } from "../../atoms/Icon";
import { hazardLabel, whenShort } from "./parts";

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
      className="sticky top-14 z-20 flex flex-col gap-2 bg-signal px-4 py-3 text-on-signal md:px-6 lg:top-0 lg:flex-row lg:items-center lg:gap-4"
    >
      <h2 id="desk-emergency" className="inline-flex shrink-0 items-center gap-2 font-bold lg:max-w-44" role="alert">
        <Icon name="triangleAlert" className="size-5" />
        {t("desk.emergency.title", { count: emergencies.length })}
      </h2>
      <ul className="flex min-w-0 gap-2 overflow-x-auto lg:flex-1">
        {emergencies.map((one) => (
          <li key={one.ticketNumber} className="shrink-0">
            <Link
              to={`/lapor/meja/${one.ticketNumber}`}
              className="flex min-h-target min-w-56 flex-col justify-center rounded-control bg-surface px-3 py-2 text-ink no-underline hover:bg-sunken"
            >
              <span className="font-bold">
                {hazardLabel(t, one.hazardType)}
                {", "}
                {t("desk.emergency.place", { village: one.villageName, regency: one.regencyName })}
              </span>
              <span className="text-meta text-muted tabular-nums">
                {one.ticketNumber}, {whenShort(t, one.sentAt)}, {t(`desk.emergency.victims.${one.victims}`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hydrated && !ready ? (
        <button
          type="button"
          className="inline-flex min-h-target-min shrink-0 items-center gap-2 self-start rounded-control border border-on-signal px-3 text-meta font-semibold hover:bg-[color-mix(in_oklch,var(--signal),var(--on-signal)_14%)] lg:self-auto"
          onClick={async () => setReady(await askForAlarm())}
        >
          <Icon name="bell" className="size-4" />
          {t("desk.emergency.turnOn")}
        </button>
      ) : null}
    </section>
  );
}
