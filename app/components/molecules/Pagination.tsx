import { Link } from "react-router";
import { buttonStyles } from "../atoms/Button";

export type PaginationLabels = { readonly summary: string; readonly previous: string; readonly next: string };

// Where a long list stands and the way to its neighbouring pages, as links, so it works with no script.
// A list that fits one page shows none of it.
export function Pagination({
  page,
  pages,
  hrefFor,
  labels,
}: {
  readonly page: number;
  readonly pages: number;
  readonly hrefFor: (page: number) => string;
  readonly labels: PaginationLabels;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={labels.summary} className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-muted">{labels.summary}</span>
      <span className="flex flex-wrap gap-3">
        {page > 1 ? (
          <Link to={hrefFor(page - 1)} rel="prev" className={buttonStyles({ variant: "secondary" })}>
            {labels.previous}
          </Link>
        ) : null}
        {page < pages ? (
          <Link to={hrefFor(page + 1)} rel="next" className={buttonStyles({ variant: "secondary" })}>
            {labels.next}
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
