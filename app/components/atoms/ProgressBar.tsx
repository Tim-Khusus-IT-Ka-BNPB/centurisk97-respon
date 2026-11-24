// How far something has come, drawn only: the words beside it say the number.
export function ProgressBar({ percent }: { readonly percent: number }) {
  return (
    <progress
      aria-hidden="true"
      max={100}
      value={percent}
      className="h-2 w-full appearance-none overflow-hidden rounded-full bg-sunken [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-sunken [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary"
    />
  );
}
