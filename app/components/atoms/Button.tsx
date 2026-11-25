import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { cn } from "../../lib/cn";

// Text wraps and never truncates.
const styles = cva(
  "inline-flex min-w-target-min items-center justify-center gap-2 rounded-control px-4 py-3 text-center text-body font-semibold break-words transition-colors duration-100 motion-reduce:transition-none active:shadow-[inset_0_0_0_1px_currentColor] aria-disabled:cursor-progress",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-[color-mix(in_oklab,var(--primary),var(--ink)_22%)]",
        secondary: "border border-control bg-surface text-ink hover:bg-sunken",
        danger: "border-2 border-danger bg-surface text-danger hover:bg-sunken",
        quiet: "px-2 font-normal text-ink underline hover:bg-sunken",
        link: "px-2 text-primary hover:bg-selected",
        quietDanger: "text-danger hover:bg-danger-tint",
        signal: "bg-signal text-on-signal hover:bg-signal-deep",
        accent:
          "bg-accent text-on-accent shadow-[0_2px_8px_oklch(0%_0_0/0.18)] hover:bg-[color-mix(in_oklab,var(--accent),white_16%)]",
        onHero: "border border-on-hero-muted/60 text-on-hero hover:bg-[oklch(100%_0_0/0.08)]",
      },
      size: { default: "min-h-target", main: "min-h-target-main", min: "min-h-target-min" },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

// One padding, size and colour each: what is passed wins over what the variant sets.
export const buttonStyles = (props: Parameters<typeof styles>[0]) => cn(styles(props));

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof styles> & {
    // While its form is on the way: the busy label shows and clicks are ignored.
    readonly busyLabel?: string | null;
  };

export function Button({ variant, size, className, busyLabel = null, children, onClick, ...props }: ButtonProps) {
  const busy = busyLabel !== null;
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) event.preventDefault();
    else onClick?.(event);
  };
  return (
    <button
      type="submit"
      {...props}
      aria-disabled={busy ? true : props["aria-disabled"]}
      onClick={click}
      className={cn(buttonStyles({ variant, size }), className)}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
