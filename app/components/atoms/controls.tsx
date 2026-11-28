import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const box =
  "w-full min-w-0 rounded-control border border-control bg-surface px-3 py-2.5 text-body text-ink placeholder:text-[color-mix(in_oklab,var(--muted),var(--surface)_14%)] focus:border-2 focus:border-primary focus:px-[11px] focus:py-[9px] focus-visible:outline-offset-2 aria-invalid:border-2 aria-invalid:border-danger aria-invalid:px-[11px] aria-invalid:py-[9px]";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={cn(box, "min-h-target", className)} />;
}

// An input led by a fixed part of the value, as +62 before a WhatsApp number. The part is named to a
// screen reader through its id, which the caller adds to the input's description.
export function PrefixedInput({
  prefix,
  prefixId,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { readonly prefix: string; readonly prefixId: string }) {
  return (
    <div className="flex min-w-0">
      <span
        id={prefixId}
        className="flex shrink-0 items-center rounded-s-control border border-e-0 border-control bg-sunken px-3 font-semibold text-ink tabular-nums"
      >
        {prefix}
      </span>
      <Input {...props} className={cn("rounded-s-none", className)} />
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(box, "min-h-target", className)} />;
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
