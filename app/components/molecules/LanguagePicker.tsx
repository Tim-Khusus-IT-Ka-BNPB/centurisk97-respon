import { Form, useLocation } from "react-router";
import { OFFERED } from "../../../src/copy/languages";
import { useText } from "../../lib/text";
import { Button } from "../atoms/Button";

// The report pages' language, from those with words of their own. Shown only when there is a
// choice; works with no script.
export function LanguagePicker() {
  const t = useText();
  const { pathname, search } = useLocation();
  if (OFFERED.length < 2) return null;
  return (
    <Form method="post" action="/lapor/bahasa" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="back" value={`${pathname}${search}`} />
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-meta font-semibold">{t("app.language.label")}</span>
        <select
          name="language"
          defaultValue={t("app.lang")}
          className="min-h-target-min rounded-control border border-control bg-surface px-3 text-ink"
        >
          {OFFERED.map(([id, name]) => (
            <option key={id} value={id} lang={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary" size="min">
        {t("app.language.submit")}
      </Button>
    </Form>
  );
}
