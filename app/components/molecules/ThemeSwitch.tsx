import { useFetcher, useLocation, useRouteLoaderData } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { nextTheme, type Theme } from "../../lib/theme";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

const ICON: Readonly<Record<Theme, IconName>> = { light: "sun", dark: "moon" };

// One button flips light and dark. Its icon and its name are the theme a press brings. A plain form
// post with no script.
export function ThemeSwitch({
  withLabel = false,
  className,
}: {
  readonly withLabel?: boolean;
  readonly className?: string;
}) {
  const t = useText();
  const fetcher = useFetcher();
  const { pathname, search } = useLocation();
  const loaded = useRouteLoaderData("root") as { readonly theme?: Theme } | undefined;
  const current = (fetcher.formData?.get("theme") as Theme | undefined) ?? loaded?.theme ?? "light";
  const next = nextTheme(current);
  const name = t(`theme.${next}`);
  return (
    <fetcher.Form method="post" action="/lapor/theme" className={className}>
      <input type="hidden" name="back" value={`${pathname}${search}`} />
      <button
        type="submit"
        name="theme"
        value={next}
        aria-label={name}
        title={name}
        className={cn(
          "inline-flex min-h-target-min min-w-target-min items-center justify-center gap-2 rounded-control text-ink hover:bg-sunken",
          withLabel ? "px-3 font-medium" : "",
        )}
      >
        <Icon name={ICON[next]} />
        {withLabel ? name : null}
      </button>
    </fetcher.Form>
  );
}
