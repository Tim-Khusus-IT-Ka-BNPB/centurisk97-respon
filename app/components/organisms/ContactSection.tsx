import { CONTACT_ROWS, CONTACT_SOCIAL, contactHref } from "../../lib/docs";
import { useText } from "../../lib/text";
import { ContactItem } from "../molecules/ContactItem";

export function ContactSection() {
  const t = useText();
  return (
    <section aria-labelledby="contact-heading" className="flex flex-col gap-6 border-t border-line pt-10">
      <div className="flex flex-col gap-1">
        <h2 id="contact-heading" className="text-section font-bold tracking-[-0.015em]">
          {t("home.contact.title")}
        </h2>
        <p className="text-muted">{t("home.contact.organisation")}</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.85fr)]">
        {CONTACT_ROWS.map((row) => {
          const value = t(row.value);
          return (
            <ContactItem
              key={row.label}
              icon={row.icon}
              label={t(row.label)}
              value={value}
              href={contactHref(row.link, value)}
              wide={row.link === null}
            />
          );
        })}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="text-meta font-semibold text-muted">{t("home.contact.channels")}</h3>
        <ul className="flex flex-wrap gap-2">
          {CONTACT_SOCIAL.map((key) => (
            <li key={key} className="rounded-full border border-line bg-surface px-3 py-1.5 text-meta text-ink">
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
