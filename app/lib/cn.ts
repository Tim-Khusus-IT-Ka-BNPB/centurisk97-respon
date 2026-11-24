import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The theme's type sizes must not be read as colours, or "text-meta text-muted" would lose one.
const merge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["meta", "body", "card", "page", "ticket"] }] } },
});

export const cn = (...classes: ClassValue[]) => merge(clsx(classes));
