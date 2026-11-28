import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { type Photo, photoOf, photoSrcSet } from "../../lib/photos";
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

// The rest of what the service offers, under the band, each on a photo of what it is about.
const MORE: readonly (Door & { readonly photo: Photo["id"] })[] = [
  { to: "/info", key: "info", icon: "map", photo: "cyclone" },
  { to: "/help#help-education", key: "education", icon: "clipboardCheck", photo: "flood" },
  { to: "/numbers", key: "numbers", icon: "phone", photo: "firefighter" },
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

// The photo is decoration under a dark veil that keeps the words readable; its credit is on the tile.
function PhotoDoor({ door }: { readonly door: (typeof MORE)[number] }) {
  const t = useText();
  const photo = photoOf(door.photo);
  const licence = photo.licence === "publicDomain" ? t("home.photo.publicDomain") : photo.licence;
  return (
    <Link
      to={door.to}
      aria-labelledby={`door-${door.key}`}
      aria-describedby={`door-${door.key}-note`}
      className="group relative isolate flex h-full min-h-44 flex-col justify-end overflow-hidden rounded-card text-on-hero no-underline shadow-card sm:min-h-56"
    >
      <img
        src={`/photos/${photo.file}-480.webp`}
        srcSet={photoSrcSet(photo)}
        sizes="(min-width: 640px) 33vw, 100vw"
        alt=""
        width={960}
        height={640}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-t from-black/85 via-black/55 to-black/10"
      />
      <span className="flex flex-col gap-1 p-4">
        <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm">
          <Icon name={door.icon} className="size-5" />
        </span>
        <span id={`door-${door.key}`} className="flex items-center gap-1 text-card font-bold">
          {t(`home.door.${door.key}`)}
          <Icon
            name="chevronRight"
            className="size-5 shrink-0 transition-transform duration-100 group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
        <span id={`door-${door.key}-note`} className="text-meta text-on-hero-muted">
          {t(`home.door.${door.key}.note`)}
        </span>
        <span className="mt-1 text-[0.6875rem] text-on-hero-muted">
          {t("home.photo.credit", { author: photo.author, licence })}
        </span>
      </span>
    </Link>
  );
}

export function MoreDoors() {
  const t = useText();
  return (
    <nav aria-label={t("home.more")}>
      <ul className="grid gap-3 sm:grid-cols-3">
        {MORE.map((door) => (
          <li key={door.key} className="min-w-0">
            <PhotoDoor door={door} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
