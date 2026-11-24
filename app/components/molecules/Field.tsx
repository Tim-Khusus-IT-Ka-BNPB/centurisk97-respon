import type { ReactNode } from "react";
import { errorIdOf, type FieldProblem, hintIdOf } from "../../lib/envelope";
import { breakAfterSlash } from "../../lib/slash";
import { useText } from "../../lib/text";
import { Label } from "../atoms/controls";
import { Icon } from "../atoms/Icon";

type ControlProps = {
  readonly id: string;
  readonly name: string;
  readonly "aria-invalid": true | undefined;
  readonly "aria-describedby": string | undefined;
  readonly autoFocus: boolean;
};

type FieldProps = {
  readonly id: string;
  readonly label: string;
  readonly unit?: string | null;
  readonly definition?: string | null;
  readonly hint?: ReactNode;
  readonly problem: FieldProblem | null;
  readonly focus?: boolean;
  readonly labelHidden?: boolean;
  readonly className?: string;
  readonly children: (control: ControlProps) => ReactNode;
};

// The line under a field naming what is wrong and the fix, tied to the field by id.
export function FieldError({ id, problem }: { readonly id: string; readonly problem: FieldProblem | null }) {
  const t = useText();
  if (problem === null) return null;
  return (
    <p id={errorIdOf(id)} className="flex items-start gap-2 text-meta text-danger">
      <Icon name="circleAlert" className="mt-px size-[1.125rem]" />
      <span>{t(problem.copyKey, problem.params)}</span>
    </p>
  );
}

// Label, definition, hint, the input, then its error: the order a reader meets them.
export function Field({
  id,
  label,
  unit,
  definition,
  hint,
  problem,
  focus = false,
  labelHidden = false,
  className,
  children,
}: FieldProps) {
  const described = [hint ? hintIdOf(id) : null, problem ? errorIdOf(id) : null].filter(Boolean).join(" ");
  return (
    <div className={className ?? "flex min-w-0 flex-col gap-1.5"}>
      <Label htmlFor={id} className={labelHidden ? "sr-only" : undefined}>
        {breakAfterSlash(label)}
        {unit ? <span className="ms-2 font-normal text-muted">{unit}</span> : null}
      </Label>
      {definition ? <p className="text-meta text-muted">{breakAfterSlash(definition)}</p> : null}
      {hint ? (
        <p id={hintIdOf(id)} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
      {children({
        id,
        name: id,
        "aria-invalid": problem ? true : undefined,
        "aria-describedby": described === "" ? undefined : described,
        autoFocus: focus,
      })}
      <FieldError id={id} problem={problem} />
    </div>
  );
}
