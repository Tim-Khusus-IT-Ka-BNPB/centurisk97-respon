import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const box =
  "w-full min-w-0 rounded-control border border-control bg-surface px-3 py-2.5 text-body text-ink placeholder:text-control focus:border-2 focus:border-primary focus:px-[11px] focus:py-[9px] focus-visible:outline-offset-2 aria-invalid:border-2 aria-invalid:border-danger aria-invalid:px-[11px] aria-invalid:py-[9px]";

// A native select drawn like the other boxes, with its own chevron so every browser shows the same.
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative flex min-w-0">
      <select {...props} className={cn(box, "min-h-target appearance-none pe-10 focus:pe-[39px]", className)}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute end-3 top-1/2 size-5 -translate-y-1/2 fill-none stroke-current stroke-2 text-muted"
      >
        <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={cn(box, "min-h-target", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cn(box, "resize-y", className)} />;
}

export function Label({ className, children, htmlFor, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label htmlFor={htmlFor} {...props} className={cn("text-body font-semibold text-ink", className)}>
      {children}
    </label>
  );
}
