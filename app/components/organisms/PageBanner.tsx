import type { SigapScene } from "../../lib/sigap";
import { useText } from "../../lib/text";
import { SigapSays } from "../molecules/Sigap";

const APP = { appName: "app.name" };

export type BannerSigap = { readonly scene: SigapScene; readonly copy: string };

// The opening band of a text page: its title and what it is for, on the home's navy, and on some
// pages Sigap beside them with a word for this page.
export function PageBanner({
  titleKey,
  leadKey,
  sigap,
}: {
  readonly titleKey: string;
  readonly leadKey?: string;
  readonly sigap?: BannerSigap;
}) {
  const t = useText();
  return (
    <section className="contours text-on-hero">
      <div className="relative mx-auto grid max-w-[72rem] items-end gap-6 px-4 py-10 md:grid-cols-[minmax(0,1fr)_22rem] md:px-6 md:py-14">
        <div className="flex flex-col gap-3">
          <h1 className="max-w-[24ch] text-section font-extrabold tracking-[-0.01em] text-balance md:text-[2.5rem] md:tracking-[-0.02em] md:leading-[1.1]">
            {t(titleKey, APP)}
          </h1>
          {leadKey ? <p className="max-w-[60ch] text-card text-on-hero-muted">{t(leadKey, APP)}</p> : null}
        </div>
        {sigap ? (
          <SigapSays scene={sigap.scene} title={t(`${sigap.copy}.title`)} text={t(`${sigap.copy}.text`)} />
        ) : null}
      </div>
    </section>
  );
}
