import type { ChangeEvent, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { breakAfterSlash } from "../../lib/slash";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

const tile =
  "flex min-h-target-main w-full min-w-0 flex-col items-start gap-2 rounded-control border border-control bg-surface p-3 text-start text-ink transition-colors duration-100 motion-reduce:transition-none hover:border-primary hover:bg-[color-mix(in_oklab,var(--surface),var(--selected)_55%)] @row:flex-row @row:items-center @row:gap-3";

type TileText = {
  readonly label: string;
  readonly note?: string | null;
  // A second line, such as "Sesuai cerita Anda" on a guessed hazard type.
  readonly extra?: string | null;
  readonly icon?: IconName | null;
};

function TileBody({ label, note, extra, icon }: TileText) {
  return (
    <>
      {icon ? (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-selected text-primary">
          <Icon name={icon} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col gap-0.5 break-words">
        <span className="text-body font-semibold">{breakAfterSlash(label)}</span>
        {extra ? <span className="text-meta font-semibold text-ink">{extra}</span> : null}
        {note ? <span className="text-meta text-pretty text-muted">{breakAfterSlash(note)}</span> : null}
      </span>
    </>
  );
}

// Tiles fill one column in a narrow card and two in a wide one, rows of equal height.
export function TileGrid({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-2 @tiles:auto-rows-fr @tiles:grid-cols-2", className)}>{children}</div>
  );
}

// A tile that answers on tap: a submit button named by its option.
export function TileButton({
  id,
  value,
  busyLabel,
  autoFocus = false,
  ...text
}: TileText & {
  readonly id?: string;
  readonly value: string;
  readonly busyLabel: string | null;
  readonly autoFocus?: boolean;
}) {
  const busy = busyLabel !== null;
  return (
    <button
      id={id}
      type="submit"
      name="optionIds"
      value={value}
      aria-disabled={busy ? true : undefined}
      onClick={(event) => busy && event.preventDefault()}
      autoFocus={autoFocus}
      className={cn(tile, "aria-disabled:cursor-progress")}
    >
      <TileBody {...text} label={busy ? busyLabel : text.label} />
    </button>
  );
}

// A native radio or checkbox inside its label. The checked state shows by border, fill and the mark.
export function TileCheck({
  id,
  type,
  name,
  value,
  checked,
  autoFocus = false,
  describedBy,
  onChange,
  ...text
}: TileText & {
  readonly id?: string;
  readonly type: "radio" | "checkbox";
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly autoFocus?: boolean;
  // The id of the error line; set only when the choice was refused.
  readonly describedBy?: string | undefined;
  readonly onChange?: ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
}) {
  return (
    <label
      className={cn(tile, "cursor-pointer has-checked:border-2 has-checked:border-primary has-checked:bg-selected")}
    >
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        defaultChecked={checked}
        autoFocus={autoFocus}
        aria-invalid={describedBy ? true : undefined}
        aria-describedby={describedBy}
        onChange={onChange}
        className="size-5 shrink-0"
      />
      <TileBody {...text} />
    </label>
  );
}
