import { Form, useLocation } from "react-router";
import { LANGUAGE_GROUPS, OFFERED } from "../../../src/copy/languages";
import { useText } from "../../lib/text";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";

// "Bahasa Batak Toba" reads as "Batak Toba" on a tile under its island.
const shortName = (name: string) => name.replace(/^Bahasa /, "");

// The report pages' language, from those with words of their own, grouped by where each is spoken.
// Closed it says the language in use; it opens and posts with no script. Shown only when there is a
// choice.
export function LanguagePicker() {
  const t = useText();
  const { pathname, search } = useLocation();
  if (OFFERED.length < 2) return null;
  const current = t("app.lang");
  const named = new Map<string, string>(OFFERED);
  const groups = LANGUAGE_GROUPS.map(([group, ids]) => [group, ids.filter((id) => named.has(id))] as const).filter(
    ([, ids]) => ids.length > 0,
  );
  return (
    <details className="group/picker card-surface">
      <summary className="flex min-h-target cursor-pointer list-none items-center gap-3 rounded-control px-4 py-2 [&::-webkit-details-marker]:hidden">
        <Icon name="globe" className="size-5 text-primary" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-meta text-muted">{t("app.language.label")}</span>
          <span className="font-semibold">{named.get(current)}</span>
        </span>
        <span className="ms-auto flex items-center gap-1 font-semibold text-primary">
          <span className="group-open/picker:hidden">{t("app.language.change")}</span>
          <Icon name="chevronRight" className="size-5 transition-transform group-open/picker:rotate-90" />
        </span>
      </summary>
      <Form method="post" action="/lapor/bahasa" className="flex flex-col gap-5 border-t border-line p-4 md:p-5">
        <input type="hidden" name="back" value={`${pathname}${search}`} />
        <h2 className="text-card font-bold">{t("app.language.title")}</h2>
        {groups.map(([group, ids]) => (
          <fieldset key={group} className="flex flex-col gap-2">
            <legend className="mb-2 flex w-full items-center gap-3 text-meta font-semibold text-primary">
              {t(`app.language.group.${group}`)}
              <span aria-hidden="true" className="h-px flex-1 bg-line" />
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ids.map((id) => (
                <label
                  key={id}
                  lang={id}
                  className="group/tile flex min-h-target cursor-pointer items-center gap-2 rounded-control border border-line bg-sunken px-3 font-semibold has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
                >
                  <input type="radio" name="language" value={id} defaultChecked={id === current} className="sr-only" />
                  <span className="min-w-0 flex-1">{shortName(named.get(id) as string)}</span>
                  <Icon name="check" className="hidden size-5 shrink-0 group-has-[:checked]/tile:block" />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Button type="submit" variant="primary" size="main" className="w-full sm:w-auto sm:self-start">
          <Icon name="check" className="size-5" />
          {t("app.language.submit")}
        </Button>
      </Form>
    </details>
  );
}
