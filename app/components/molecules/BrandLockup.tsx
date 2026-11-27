import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Emblem } from "../atoms/Emblem";

// BNPB's emblem and the Pantau Bencana shield (upstream's mark, chosen by the owner on 25 Nov), with
// the service's name and BNPB's full name under it. A 320px phone keeps the emblem alone, so the
// header stays one row.
export function BrandLockup({ tone = "page" }: { readonly tone?: "page" | "hero" }) {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-3">
      <span className="flex shrink-0 items-center gap-1.5">
        <Emblem size={tone === "hero" ? 32 : 40} className={tone === "hero" ? undefined : "size-8 sm:size-10"} />
        <img
          src="/logo-pantau.svg"
          alt=""
          width={40}
          height={40}
          className={cn("hidden shrink-0 min-[360px]:block", tone === "hero" ? "size-8" : "size-8 sm:size-10")}
        />
      </span>
      <span className="flex flex-col leading-tight">
        <span
          className={cn(
            "font-bold tracking-[-0.01em]",
            tone === "hero" ? "text-body text-on-hero" : "text-body sm:text-card",
          )}
        >
          {t("app.name")}
        </span>
        <span
          className={cn(tone === "hero" ? "text-meta text-on-hero-muted" : "text-[0.75rem] text-muted sm:text-meta")}
        >
          {t("home.contact.organisation")}
        </span>
      </span>
    </span>
  );
}
