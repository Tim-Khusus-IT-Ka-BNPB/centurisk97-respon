import { cn } from "../../lib/cn";
import { sigapSrc } from "../../lib/sigap";

// Sigap's face in a circle, beside what Sigap says; decoration, so it says nothing itself.
export function SigapAvatar({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block size-9 shrink-0 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--accent),white_70%)] ring-2 ring-surface",
        className,
      )}
    >
      <img
        src={sigapSrc("sapa")}
        alt=""
        width={640}
        height={640}
        decoding="async"
        className="absolute top-[-34%] left-1/2 w-[245%] max-w-none -translate-x-1/2"
      />
    </span>
  );
}
