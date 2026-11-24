import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { Emblem } from "../atoms/Emblem";

// The emblem with the service's name and BNPB's full name under it.
export function BrandLockup({ tone = "page" }: { readonly tone?: "page" | "hero" }) {
  const t = useText();
  return (
    <span className="inline-flex items-center gap-3">
      <Emblem size={tone === "hero" ? 32 : 40} />
      <span className="flex flex-col leading-tight">
        <span className={cn("font-bold tracking-[-0.01em]", tone === "hero" ? "text-body text-on-hero" : "text-card")}>
          {t("app.name")}
        </span>
        <span className={cn("text-meta", tone === "hero" ? "text-on-hero-muted" : "text-muted")}>
          {t("home.contact.organisation")}
        </span>
      </span>
    </span>
  );
}
