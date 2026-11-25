import { cn } from "../../lib/cn";

// One way to reach BNPB: what it is, and the value, as a link when it opens something.
export function ContactItem({
  label,
  value,
  href,
  wide = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly href: string | null;
  readonly wide?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2 lg:col-span-1")}>
      <dt className="text-meta text-muted">{label}</dt>
      <dd className="min-w-0 font-semibold [overflow-wrap:anywhere] tabular-nums">
        {href ? (
          <a href={href} className="inline-flex min-h-target-min items-center underline underline-offset-4">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
