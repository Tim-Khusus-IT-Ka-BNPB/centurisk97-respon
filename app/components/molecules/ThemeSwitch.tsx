import { useFetcher, useLocation, useRouteLoaderData } from "react-router";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { nextTheme, type Theme } from "../../lib/theme";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

const ICON: Readonly<Record<Theme, IconName>> = { device: "monitor", light: "sun", dark: "moon" };

// One button walks the themes: device, light, dark. Its icon shows the one in use and its name
// says which comes next. A plain form post with no script.
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
  const current = (fetcher.formData?.get("theme") as Theme | undefined) ?? loaded?.theme ?? "device";
  const next = nextTheme(current);
  const name = t("theme.switch", { current: `theme.${current}`, next: `theme.${next}` });
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
        <Icon name={ICON[current]} />
        {withLabel ? <span aria-hidden="true">{t(`theme.${current}`)}</span> : null}
      </button>
    </fetcher.Form>
  );
}
