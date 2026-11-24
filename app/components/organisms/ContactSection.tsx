import { CONTACT_ROWS, CONTACT_SOCIAL, contactHref } from "../../lib/docs";
import { useText } from "../../lib/text";
import { ContactItem } from "../molecules/ContactItem";

export function ContactSection() {
  const t = useText();
  return (
    <section
      aria-labelledby="contact-heading"
      className="grid gap-6 border-t border-line pt-10 lg:grid-cols-[1fr_2fr] lg:gap-16"
    >
      <div className="flex flex-col gap-2">
        <h2 id="contact-heading" className="text-section font-bold tracking-[-0.015em]">
          {t("home.contact.title")}
        </h2>
        <p className="text-muted">{t("home.contact.organisation")}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {CONTACT_ROWS.map((row) => {
            const value = t(row.value);
            return (
              <ContactItem
                key={row.label}
                label={t(row.label)}
                value={value}
                href={contactHref(row.link, value)}
                wide={row.link === null}
              />
            );
          })}
        </dl>
        <ul className="flex flex-wrap gap-2 text-meta">
          {CONTACT_SOCIAL.map((key) => (
            <li key={key} className="rounded-chip bg-sunken px-3 py-1.5 text-muted">
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
