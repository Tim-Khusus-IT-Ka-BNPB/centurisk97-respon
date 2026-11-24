import { StepNumber } from "../atoms/StepNumber";

// One step of a sequence: its number, its name, and what happens in it.
export function Step({
  number,
  title,
  body,
}: {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <li className="flex gap-4">
      <StepNumber value={number} />
      <div className="flex min-w-0 flex-col gap-1 pt-1">
        <h3 className="font-bold">{title}</h3>
        <p className="text-muted">{body}</p>
      </div>
    </li>
  );
}
