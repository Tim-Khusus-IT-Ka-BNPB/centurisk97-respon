import { cn } from "../../lib/cn";

// BNPB's emblem. Always beside the name it stands for, so it carries no text of its own.
export function Emblem({ size = 40, className }: { readonly size?: 32 | 40; readonly className?: string }) {
  return (
    <img
      src="/lambang-bnpb.png"
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0", size === 32 ? "size-8" : "size-10", className)}
    />
  );
}
