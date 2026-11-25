import { cn } from "../../lib/cn";
import { Icon } from "../atoms/Icon";

// A number to call now: the number first, who answers, and the mark of a call.
export function CallRow({
  number,
  label,
  first = false,
}: {
  readonly number: string;
  readonly label: string;
  // The one to call before the others.
  readonly first?: boolean;
}) {
  const short = number.length <= 4;
  return (
    <a
      href={`tel:${number.replace(/[^\d+]/g, "")}`}
      className={cn(
        "flex min-h-target-main flex-wrap items-center gap-x-4 gap-y-1 rounded-control border px-4 py-2.5 no-underline",
        first
          ? "border-signal bg-signal text-on-signal hover:bg-signal-deep"
          : "border-line bg-surface text-ink hover:border-signal",
      )}
    >
      {short ? <span className="text-ticket font-extrabold tabular-nums">{number}</span> : null}{" "}
      <span className="flex min-w-24 flex-1 flex-col">
        <span className="font-semibold">{label}</span> {short ? null : <span className="tabular-nums">{number}</span>}
      </span>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          first ? "bg-on-signal text-signal" : "bg-signal-tint text-signal",
        )}
      >
        <Icon name="phone" className="size-5" />
      </span>
    </a>
  );
}
