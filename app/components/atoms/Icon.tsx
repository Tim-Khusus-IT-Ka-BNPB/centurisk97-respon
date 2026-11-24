import { createElement } from "react";
import { cn } from "../../lib/cn";
import { ICONS, type IconName } from "./icons";

// Always beside its word, so hidden from assistive technology.
export function Icon({ name, className }: { readonly name: IconName; readonly className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5 shrink-0", className)}
    >
      {ICONS[name].map(([tag, attributes]) => createElement(tag, { key: JSON.stringify(attributes), ...attributes }))}
    </svg>
  );
}
