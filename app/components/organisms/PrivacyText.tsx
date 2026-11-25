import { localDateText } from "../../../src/copy/time";
import { PRIVACY } from "../../../src/domain/privacy";
import { PRIVACY_META, PRIVACY_SECTIONS } from "../../lib/docs";
import { useText } from "../../lib/text";

const APP = { appName: "app.name" };

// The privacy text, read in place on the form and as its own page.
export function PrivacyText({ headingLevel }: { readonly headingLevel: 2 | 3 }) {
  const t = useText();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="flex max-w-[65ch] flex-col gap-4">
      <p className="text-meta text-muted">{t("privacy.draftNote")}</p>
      <p>{t("privacy.intro", APP)}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-meta">
        {PRIVACY_META.map((part) => (
          <div key={part} className="contents">
            <dt className="text-muted">{t(`privacy.meta.${part}Label`)}</dt>
            <dd className="tabular-nums">
              {t(`privacy.meta.${part}`, { effectiveDate: localDateText(PRIVACY.effectiveDate) })}
            </dd>
          </div>
        ))}
      </dl>
      {PRIVACY_SECTIONS.map(({ section, parts }) => {
        const items = parts.filter((part) => part.startsWith("item"));
        return (
          <section
            key={section}
            aria-labelledby={`privacy-${section}-${headingLevel}`}
            className="flex flex-col gap-2 pt-2"
          >
            <Heading
              id={`privacy-${section}-${headingLevel}`}
              className={
                headingLevel === 2
                  ? "scroll-mt-6 pt-4 text-page font-bold tracking-[-0.01em]"
                  : "scroll-mt-4 text-body font-bold"
              }
            >
              {t(`privacy.${section}.title`)}
            </Heading>
            {parts
              .filter((part) => part === "p1")
              .map((part) => (
                <p key={part}>{t(`privacy.${section}.${part}`, APP)}</p>
              ))}
            {items.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 ps-5">
                {items.map((part) => (
                  <li key={part}>{t(`privacy.${section}.${part}`, APP)}</li>
                ))}
              </ul>
            ) : null}
            {parts
              .filter((part) => part === "p2")
              .map((part) => (
                <p key={part}>{t(`privacy.${section}.${part}`, APP)}</p>
              ))}
          </section>
        );
      })}
    </div>
  );
}
