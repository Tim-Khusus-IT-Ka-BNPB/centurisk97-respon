import type { InputHTMLAttributes, LabelHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const box =
  "w-full min-w-0 rounded-control border border-control bg-surface px-3 py-2.5 text-body text-ink placeholder:text-control focus:border-2 focus:border-primary focus:px-[11px] focus:py-[9px] focus-visible:outline-offset-2 aria-invalid:border-2 aria-invalid:border-danger aria-invalid:px-[11px] aria-invalid:py-[9px]";

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
