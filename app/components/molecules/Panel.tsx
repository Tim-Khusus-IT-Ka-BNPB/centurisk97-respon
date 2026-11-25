import type { ReactNode } from "react";
import { useMountFocus } from "../../lib/hooks";

// A card outside the draft: a section named by its heading, which takes focus when it arrives
// unless a refused field takes it.
export function Panel({
  id,
  title,
  lead,
  focusHeading = true,
  level = 2,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly lead?: string | null;
  readonly focusHeading?: boolean;
  // 1 where the panel is the page.
  readonly level?: 1 | 2;
  readonly children?: ReactNode;
}) {
  const heading = useMountFocus<HTMLHeadingElement>(focusHeading);
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section
      aria-labelledby={id}
      className="@container flex min-w-0 animate-settle flex-col gap-5 card-surface p-5 md:p-7"
    >
      <div className="flex flex-col gap-2">
        <Heading
          id={id}
          ref={heading}
          tabIndex={-1}
          autoFocus={focusHeading}
          className="text-page font-bold text-balance"
        >
          {title}
        </Heading>
        {lead ? <p className="text-muted">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}
