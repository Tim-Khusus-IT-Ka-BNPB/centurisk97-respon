import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Form, useLocation } from "react-router";
import { LANGUAGE_GROUPS, OFFERED } from "../../../src/copy/languages";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";

// "Bahasa Batak Toba" reads as "Batak Toba" on a tile under its island; "Bahasa Indonesia" as "Indonesia".
const shortName = (name: string) => name.replace(/^Bahasa /, "");

// A group's tiles in as many columns as fit them evenly, as upstream lays them out.
const COLUMNS: Readonly<Record<number, string>> = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };
const columnsFor = (count: number) => (count % 3 === 0 ? COLUMNS[3] : count === 4 ? COLUMNS[4] : "");

// The languages with words of their own, grouped by where each is spoken, and the button that keeps
// the one picked. Before the page runs its script the button cannot follow the pick, so it says
// only that it keeps it.
export function LanguageChooser({ back, onClose }: { readonly back: string; readonly onClose: ReactNode }) {
  const t = useText();
  const current = t("app.lang");
  const named = new Map<string, string>(OFFERED);
  const [picked, setPicked] = useState(current);
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  const groups = LANGUAGE_GROUPS.map(([group, ids]) => [group, ids.filter((id) => named.has(id))] as const).filter(
    ([, ids]) => ids.length > 0,
  );
  return (
    <div className="flex max-h-full min-h-0 flex-col overflow-hidden rounded-[1.25rem] bg-surface">
      <div className="contours flex items-center justify-between gap-4 px-5 py-6 text-on-hero md:px-8 md:py-8">
        <h2 id="language-title" className="flex items-center gap-3 text-section font-extrabold tracking-[-0.015em]">
          <Icon name="globe" className="size-8 shrink-0" />
          {t("app.language.title")}
        </h2>
        {onClose}
      </div>
      <Form method="post" action="/lapor/bahasa" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="back" value={back} />
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5 md:px-8 md:py-6">
          {groups.map(([group, ids]) => (
            <fieldset key={group} className="flex flex-col gap-2">
              <legend className="mb-2 flex w-full items-center gap-3 font-bold text-primary">
                {t(`app.language.group.${group}`)}
                <span aria-hidden="true" className="h-px flex-1 bg-line" />
              </legend>
              <div className={cn("grid grid-cols-2 gap-2.5", columnsFor(ids.length))}>
                {ids.map((id) => (
                  <label
                    key={id}
                    lang={id}
                    className="group/tile flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 border-transparent bg-sunken px-3 font-bold sm:min-h-14 sm:px-4 sm:text-card text-ink transition-colors duration-100 motion-reduce:transition-none hover:border-line has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary"
                  >
                    <input
                      type="radio"
                      name="language"
                      value={id}
                      defaultChecked={id === current}
                      onChange={() => setPicked(id)}
                      className="sr-only"
                    />
                    <span className="min-w-0 flex-1">{shortName(named.get(id) as string)}</span>
                    <Icon name="check" className="hidden size-5 shrink-0 group-has-[:checked]/tile:block" />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="border-t border-line px-5 py-4 md:px-8 md:py-5">
          <Button type="submit" variant="primary" size="main" className="w-full">
            <Icon name="check" className="size-5" />
            {live ? t("app.language.continue", { name: named.get(picked) as string }) : t("app.language.submit")}
          </Button>
        </div>
      </Form>
    </div>
  );
}

// The page the chooser opens as, coming back here after.
function useChooser() {
  const t = useText();
  const { pathname, search } = useLocation();
  const back = `${pathname}${search}`;
  return {
    back,
    href: `/lapor/bahasa?back=${encodeURIComponent(back)}`,
    current: new Map<string, string>(OFFERED).get(t("app.lang")) as string,
  };
}

// The language in a phone's menu, opening the chooser as a page, so the bar keeps one row.
export function LanguageLink({ className }: { readonly className: string }) {
  const t = useText();
  const { href, current } = useChooser();
  if (OFFERED.length < 2) return null;
  return (
    <a href={href} aria-label={t("app.language.open", { name: current })} className={className}>
      <Icon name="globe" className="size-5" />
      {current}
    </a>
  );
}

// The site's language, in the header of every public page: it says the language in use and opens the
// chooser in a dialog, or with no script as a page of its own. Shown only when there is a choice.
export function LanguagePicker({ className }: { readonly className?: string }) {
  const t = useText();
  const dialog = useRef<HTMLDialogElement>(null);
  const { back, href, current } = useChooser();
  if (OFFERED.length < 2) return null;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (typeof dialog.current?.showModal !== "function") return;
    event.preventDefault();
    dialog.current.showModal();
  };
  return (
    <>
      <a
        href={href}
        onClick={open}
        aria-label={t("app.language.open", { name: current })}
        className={cn(
          "inline-flex min-h-target-min items-center gap-1.5 rounded-control px-2 font-semibold text-ink no-underline hover:bg-sunken",
          className,
        )}
      >
        <Icon name="globe" className="size-5" />
        <span className="hidden sm:inline">{shortName(current)}</span>
      </a>
      <dialog
        ref={dialog}
        aria-labelledby="language-title"
        className="m-auto h-fit max-h-[calc(100dvh-2rem)] w-[min(56rem,calc(100%-2rem))] overflow-hidden rounded-[1.25rem] bg-transparent p-0 shadow-2xl backdrop:bg-[color-mix(in_oklab,var(--ink),transparent_45%)] backdrop:backdrop-blur-sm open:flex open:flex-col"
      >
        <LanguageChooser
          back={back}
          onClose={
            <form method="dialog">
              <button
                type="submit"
                aria-label={t("app.language.close")}
                className="flex size-target shrink-0 items-center justify-center rounded-full text-on-hero hover:bg-white/10"
              >
                <Icon name="x" className="size-7" />
              </button>
            </form>
          }
        />
      </dialog>
    </>
  );
}
