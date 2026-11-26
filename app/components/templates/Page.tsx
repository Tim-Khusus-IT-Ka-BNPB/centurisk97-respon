import { type ReactNode, useMemo } from "react";
import { makeText, type Texts } from "../../../src/copy/text";
import { cn } from "../../lib/cn";
import { TextContext } from "../../lib/text";
import { PageBanner } from "../organisms/PageBanner";
import { SideRail } from "../organisms/SideRail";
import { SiteFooter } from "../organisms/SiteFooter";
import { SiteHeader } from "../organisms/SiteHeader";

const SITE = "max-w-[72rem]";

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
}) {
  const text = useMemo(() => makeText(texts), [texts]);
  // The header, any band and the footer share the site's width; a page of one task keeps a narrower
  // column under them, centred.
  const width = wide || aside ? SITE : "max-w-[40rem]";
  return (
    <TextContext.Provider value={text}>
      <div className={cn("flex min-h-dvh flex-col", publicPage && "lg:ps-[4.75rem]")} lang={text("app.lang")}>
        {publicPage ? <SideRail /> : null}
        <SiteHeader nav={publicPage} width={SITE} />
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
            {children}
            {dock}
          </div>
          {aside ? (
            <aside className="hidden lg:block">
              <div className="sticky top-6">{aside}</div>
            </aside>
          ) : null}
        </main>
        {publicPage ? <SiteFooter width={SITE} /> : null}
      </div>
    </TextContext.Provider>
  );
}
