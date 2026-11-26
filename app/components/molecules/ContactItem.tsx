import { cn } from "../../lib/cn";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

// One way to reach BNPB as a card: its mark, what it is, and the value. A value that opens something
// makes the whole card the link.
export function ContactItem({
  icon,
  label,
  value,
  href,
  wide = false,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly value: string;
  readonly href: string | null;
  readonly wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 items-center gap-4 card-surface px-4 py-3.5 transition-colors duration-100 motion-reduce:transition-none",
        href && "hover:border-primary has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-primary",
        wide && "sm:col-span-2 lg:col-span-4",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-selected text-primary"
      >
        <Icon name={icon} className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <dt className="text-meta text-muted">{label}</dt>
        <dd className="min-w-0 font-semibold [overflow-wrap:anywhere] tabular-nums">
          {href ? (
            <a href={href} className="text-ink no-underline after:absolute after:inset-0 focus-visible:outline-none">
              {value}
            </a>
          ) : (
            value
          )}
        </dd>
      </span>
    </div>
  );
}
