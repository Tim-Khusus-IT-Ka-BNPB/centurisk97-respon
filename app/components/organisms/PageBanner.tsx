import { useText } from "../../lib/text";

const APP = { appName: "app.name" };

// The opening band of a text page: its title and what it is for, on the home's navy.
export function PageBanner({ titleKey, leadKey }: { readonly titleKey: string; readonly leadKey?: string }) {
  const t = useText();
  return (
    <section className="contours text-on-hero">
      <div className="relative mx-auto flex max-w-[72rem] flex-col gap-3 px-4 py-10 md:px-6 md:py-14">
        <h1 className="max-w-[24ch] text-section font-extrabold tracking-[-0.01em] text-balance md:text-[2.5rem] md:tracking-[-0.02em] md:leading-[1.1]">
          {t(titleKey, APP)}
        </h1>
        {leadKey ? <p className="max-w-[60ch] text-card text-on-hero-muted">{t(leadKey, APP)}</p> : null}
      </div>
    </section>
  );
}
