import { type ReactNode, useMemo } from "react";
import { makeText, type Texts } from "../../../src/copy/text";
import { cn } from "../../lib/cn";
import { TextContext } from "../../lib/text";
import { LanguagePicker } from "../molecules/LanguagePicker";
import { PageBanner } from "../organisms/PageBanner";
import { SiteFooter } from "../organisms/SiteFooter";
import { SiteHeader } from "../organisms/SiteHeader";

// A page that draws its own frame (the desk) still needs its share of the copy.
export function WithTexts({ texts, children }: { readonly texts: Texts; readonly children: ReactNode }) {
  const text = useMemo(() => makeText(texts), [texts]);
  return <TextContext.Provider value={text}>{children}</TextContext.Provider>;
}

// Every page: the copy it was handed, the header band, its column, and on public pages the footer.
export function Page({
  texts,
  wide = false,
  publicPage = true,
  hero,
  banner,
  aside,
  children,
  dock,
  languages = false,
}: {
  readonly texts: Texts;
  // Public pages use a wide container that fills the screen; the report uses one centred column.
  readonly wide?: boolean;
  readonly publicPage?: boolean;
  // A full-width opening band above the column, for the home.
  readonly hero?: ReactNode;
  // A text page's title band: its catalogue keys.
  readonly banner?: { readonly title: string; readonly lead?: string };
  readonly children: ReactNode;
  // A column beside the content on a wide screen, as the report's progress beside its conversation.
  readonly aside?: ReactNode;
  // The message box, docked under the content column.
  readonly dock?: ReactNode;
  // The report pages offer their language above the content.
  readonly languages?: boolean;
}) {
  const text = useMemo(() => makeText(texts), [texts]);
  // The header lines up with the column under it.
  const width = wide || aside ? "max-w-[72rem]" : "max-w-[40rem]";
  return (
    <TextContext.Provider value={text}>
      <div className="flex min-h-dvh flex-col" lang={text("app.lang")}>
        <SiteHeader nav={publicPage} width={width} />
        {hero}
        {banner ? <PageBanner titleKey={banner.title} leadKey={banner.lead} /> : null}
        <main
          className={cn(
            "mx-auto grid w-full flex-1 grid-cols-1 content-start px-4 pt-8 md:px-6 md:pt-10",
            aside ? "gap-10 lg:grid-cols-[minmax(0,1fr)_19rem]" : "",
            dock ? "" : "pb-8 md:pb-10",
            width,
          )}
        >
          <div className="flex min-w-0 flex-col gap-6">
            {languages ? <LanguagePicker /> : null}
            {children}
            {dock}
          </div>
          {aside ? (
            <aside className="hidden lg:block">
              <div className="sticky top-6">{aside}</div>
            </aside>
          ) : null}
        </main>
        {publicPage ? <SiteFooter width={width} /> : null}
      </div>
    </TextContext.Provider>
  );
}
