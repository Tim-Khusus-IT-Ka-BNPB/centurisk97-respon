import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

type Door = { readonly to: string; readonly key: string; readonly icon: IconName };

// The three ways to report, on the opening band (upstream's home grid, 25 Nov): an emergency in red,
// an event in orange, a missing person in the band's own light.
const REPORTS: readonly (Door & { readonly look: string })[] = [
  {
    to: "/report?emergency=1",
    key: "emergency",
    icon: "triangleAlert",
    look: "bg-signal text-on-signal hover:bg-signal-deep",
  },
  {
    to: "/report",
    key: "report",
    icon: "send",
    look: "bg-accent text-on-accent hover:bg-[color-mix(in_oklab,var(--accent),white_16%)]",
  },
  { to: "/missing", key: "missing", icon: "userSearch", look: "bg-surface text-ink hover:bg-sunken" },
];

// The rest of what the service offers, under the band.
const MORE: readonly Door[] = [
  { to: "/info", key: "info", icon: "map" },
  { to: "/help#help-education", key: "education", icon: "clipboardCheck" },
  { to: "/numbers", key: "numbers", icon: "phone" },
];

export function ReportDoors() {
  const t = useText();
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {REPORTS.map((door) => (
        <li key={door.key} className="min-w-0">
          <Link
            to={door.to}
            aria-labelledby={`door-${door.key}`}
            aria-describedby={`door-${door.key}-note`}
            className={cn(
              "flex h-full min-h-28 flex-col justify-between gap-3 rounded-[1rem] p-4 no-underline shadow-sm transition duration-100 motion-reduce:transition-none",
              door.look,
            )}
          >
            <Icon name={door.icon} className="size-7" />
            <span className="flex flex-col gap-0.5">
              <span id={`door-${door.key}`} className="text-card font-extrabold">
                {t(`home.door.${door.key}`)}
              </span>
              <span id={`door-${door.key}-note`} className="text-meta opacity-90">
                {t(`home.door.${door.key}.note`)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MoreDoors() {
  const t = useText();
  return (
    <nav aria-label={t("home.more")}>
      <ul className="grid gap-3 sm:grid-cols-3">
        {MORE.map((door) => (
          <li key={door.key} className="min-w-0">
            <Link
              to={door.to}
              aria-labelledby={`door-${door.key}`}
              aria-describedby={`door-${door.key}-note`}
              className="flex h-full items-center gap-4 card-surface p-4 text-ink no-underline hover:border-primary"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-selected text-primary">
                <Icon name={door.icon} className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span id={`door-${door.key}`} className="font-bold">
                  {t(`home.door.${door.key}`)}
                </span>
                <span id={`door-${door.key}-note`} className="text-meta text-muted">
                  {t(`home.door.${door.key}.note`)}
                </span>
              </span>
              <Icon name="chevronRight" className="ms-auto size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
