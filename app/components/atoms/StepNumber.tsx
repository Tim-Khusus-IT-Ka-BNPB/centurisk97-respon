// The place of a step in its sequence; the list already says it to assistive technology.
export function StepNumber({ value }: { readonly value: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-selected font-bold text-primary tabular-nums"
    >
      {value}
    </span>
  );
}
