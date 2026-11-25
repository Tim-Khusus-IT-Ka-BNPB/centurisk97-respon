import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { ABOUT_POINTS, ABOUT_STEPS, HELP_GROUPS, PRIVACY_SECTIONS } from "../../lib/docs";
import { useText } from "../../lib/text";
import { localDateText } from "../../lib/time";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { CallRow } from "../molecules/CallRow";
import { Step } from "../molecules/Step";
import { PrivacyText } from "./PrivacyText";

const APP = { appName: "app.name" };

// A text page under its banner: one column on a phone; on a wide screen a sticky index of its sections on the left.
function DocLayout({
  index,
  children,
}: {
  readonly index: readonly { readonly id: string; readonly label: string }[];
  readonly children: ReactNode;
}) {
  const t = useText();
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr] lg:gap-16">
      <nav aria-labelledby="index-heading" className="hidden lg:block">
        <div className="sticky top-6 flex flex-col border-l border-line">
          <h2 id="index-heading" className="px-4 pb-2 text-meta font-semibold text-muted">
            {t("nav.onThisPage")}
          </h2>
          {index.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className="-ml-px flex min-h-target-min items-center border-l-2 border-transparent px-4 text-muted hover:border-primary hover:text-ink"
            >
              {entry.label}
            </a>
          ))}
        </div>
      </nav>
      <div className="flex min-w-0 max-w-[68ch] flex-col gap-10">{children}</div>
    </div>
  );
}

export type Education = {
  readonly dataDate: string;
  readonly topics: readonly {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly lists: readonly { readonly kind: string; readonly items: readonly string[] }[];
    readonly sources: readonly { readonly organisation: string; readonly title: string; readonly url: string }[];
  }[];
};

// "Edukasi siaga" (K28): the preparedness topics as imported, each with its sources. Content from
// the file, not the copy catalogue; when it cannot be read, the group says so.
function EducationGroup({ education }: { readonly education: Education | null }) {
  const t = useText();
  return (
    <section aria-labelledby="help-education" className="flex flex-col gap-3">
      <h2 id="help-education" className="scroll-mt-6 text-page font-bold tracking-[-0.01em]">
        {t("help.group.education")}
      </h2>
      <p className="text-muted">{t("help.education.lead")}</p>
      {education === null ? <p>{t("help.education.unavailable")}</p> : null}
      <div className="overflow-hidden card-surface empty:hidden">
        {education?.topics.map((topic) => (
          <details key={topic.id} className="group border-t border-line first:border-t-0">
            <summary className="flex min-h-target-main list-none items-center justify-between gap-4 px-5 py-3 font-semibold hover:bg-sunken/60 [&::-webkit-details-marker]:hidden">
              {topic.title}
              <Icon name="chevronRight" className="text-muted transition-transform group-open:rotate-90" />
            </summary>
            <div className="flex flex-col gap-4 px-5 pb-5">
              <p>{topic.summary}</p>
              {topic.lists.map((list) => (
                <div key={list.kind} className="flex flex-col gap-1">
                  <h3 className="font-bold">{t(`help.education.${list.kind}`)}</h3>
                  <ul className="flex list-disc flex-col gap-1 ps-5">
                    {list.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <h3 className="font-bold">{t("help.education.sources")}</h3>
                <ul className="flex flex-col gap-1">
                  {topic.sources.map((source) => (
                    <li key={source.url + source.title}>
                      <a
                        href={source.url}
                        rel="noreferrer"
                        className="underline underline-offset-4 [overflow-wrap:anywhere]"
                      >
                        {source.organisation}: {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        ))}
      </div>
      {education ? (
        <p className="text-meta text-muted">
          {t("help.education.dataDate", { dataDate: localDateText(education.dataDate) })}
        </p>
      ) : null}
    </section>
  );
}

export function HelpScreen({ education }: { readonly education: Education | null }) {
  const t = useText();
  const index = HELP_GROUPS.map(({ group }) => ({ id: `help-${group}`, label: t(`help.group.${group}`) }));
  index.splice(index.length - 1, 0, { id: "help-education", label: t("help.group.education") });
  return (
    <DocLayout index={index}>
      {HELP_GROUPS.map(({ group, items }) => (
        <Fragment key={group}>
          {group === "privacy" ? <EducationGroup education={education} /> : null}
          <section aria-labelledby={`help-${group}`} className="flex flex-col gap-3">
            <h2 id={`help-${group}`} className="scroll-mt-6 text-page font-bold tracking-[-0.01em]">
              {t(`help.group.${group}`)}
            </h2>
            <div className="overflow-hidden card-surface">
              {items.map((item) => (
                <details key={item} className="group border-t border-line first:border-t-0">
                  <summary className="flex min-h-target-main list-none items-center justify-between gap-4 px-5 py-3 font-semibold hover:bg-sunken/60 [&::-webkit-details-marker]:hidden">
                    {t(`help.${group}.${item}.q`)}
                    <Icon name="chevronRight" className="text-muted transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="max-w-[65ch] px-5 pb-5 text-muted">{t(`help.${group}.${item}.a`)}</p>
                </details>
              ))}
            </div>
            {group === "privacy" ? (
              <Link to="/lapor/privacy" className={buttonStyles({ variant: "link", className: "-ms-2 self-start" })}>
                {t("help.privacy.fullLink")}
              </Link>
            ) : null}
          </section>
        </Fragment>
      ))}
    </DocLayout>
  );
}

const ABOUT_SECTIONS = ["what", "steps", "words", "tips", "emergency", "limits"] as const;

export function AboutScreen() {
  const t = useText();
  const heading = (id: (typeof ABOUT_SECTIONS)[number]) => t(`about.${id}.title`, APP);
  const section = (id: (typeof ABOUT_SECTIONS)[number], children: ReactNode) => (
    <section aria-labelledby={`about-${id}`} className="flex flex-col gap-3">
      <h2 id={`about-${id}`} className="scroll-mt-6 text-page font-bold tracking-[-0.01em]">
        {heading(id)}
      </h2>
      {children}
    </section>
  );
  return (
    <DocLayout index={ABOUT_SECTIONS.map((id) => ({ id: `about-${id}`, label: heading(id) }))}>
      {section(
        "what",
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {ABOUT_POINTS.map((point) => (
            <li key={point} className="flex flex-col gap-1 border-t-2 border-primary pt-3">
              <strong>{t(`about.card.${point}.title`)}</strong>
              <span className="text-muted">{t(`about.card.${point}.body`)}</span>
            </li>
          ))}
        </ul>,
      )}
      {section(
        "steps",
        <ol className="flex flex-col gap-5">
          {ABOUT_STEPS.map((step) => (
            <Step key={step} number={step} title={t(`about.step${step}.title`)} body={t(`about.step${step}.body`)} />
          ))}
        </ol>,
      )}
      {section(
        "words",
        <ul className="flex list-disc flex-col gap-1 ps-5">
          <li>{t("about.words.back")}</li>
          <li>{t("about.words.cancel")}</li>
        </ul>,
      )}
      {section(
        "tips",
        <div className="flex flex-col gap-3">
          <h3 className="font-bold">{t("about.do.title")}</h3>
          <ul className="flex list-disc flex-col gap-1 ps-5">
            <li>{t("about.do.place")}</li>
            <li>{t("about.do.ownCount")}</li>
          </ul>
          <h3 className="font-bold">{t("about.avoid.title")}</h3>
          <ul className="flex list-disc flex-col gap-1 ps-5">
            <li>{t("about.avoid.guess")}</li>
            <li>{t("about.avoid.false")}</li>
          </ul>
        </div>,
      )}
      {section(
        "emergency",
        <>
          <p>{t("about.emergency.body")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["112", "117"] as const).map((line) => (
              <CallRow
                key={line}
                number={t(`about.emergency.${line}`)}
                label={t(`about.emergency.${line}Label`)}
                first={line === "112"}
              />
            ))}
          </div>
        </>,
      )}
      {section(
        "limits",
        <>
          <p className="tabular-nums">{t("about.limits")}</p>
          <p className="text-meta text-muted">{t("about.limits.why")}</p>
        </>,
      )}
    </DocLayout>
  );
}

export function PrivacyScreen() {
  const t = useText();
  return (
    <DocLayout
      index={PRIVACY_SECTIONS.map(({ section }) => ({
        id: `privacy-${section}-2`,
        label: t(`privacy.${section}.title`),
      }))}
    >
      <PrivacyText headingLevel={2} />
    </DocLayout>
  );
}
