import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Props = { readonly children: ReactNode; readonly className?: string };

// Components carry no outer margin; the space between siblings belongs to rows like this one.
// A column of full-width actions in a narrow card, a wrapping row in a wide one. The primary
// action comes last, nearest the thumb.
export function ActionRow({ children, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 *:min-w-0 @actions:flex-row @actions:flex-wrap @actions:items-center @actions:gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
