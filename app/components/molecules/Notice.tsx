import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

type NoticeKind = "info" | "refusal" | "limit" | "danger" | "error";

const LOOK: Readonly<Record<NoticeKind, { panel: string; icon: IconName; iconColour: string }>> = {
  info: { panel: "bg-sunken border-line", icon: "info", iconColour: "text-ink" },
  refusal: { panel: "bg-sunken border-line", icon: "messageCircleX", iconColour: "text-ink" },
  limit: { panel: "bg-sunken border-line", icon: "clock", iconColour: "text-ink" },
  danger: { panel: "bg-warn-tint border-line", icon: "triangleAlert", iconColour: "text-warn-icon" },
  error: { panel: "bg-danger-tint border-line text-danger", icon: "circleAlert", iconColour: "text-danger" },
};

// A panel with an edge, an icon and words: the state is never carried by colour alone.
export function Notice({ kind, children }: { readonly kind: NoticeKind; readonly children: ReactNode }) {
  const look = LOOK[kind];
  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      className={cn("flex items-start gap-3 rounded-control border p-3 text-body", look.panel)}
    >
      <Icon name={look.icon} className={cn("mt-0.5", look.iconColour)} />
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}

// The 112 line: call now when a life is at risk. Only the newest one is drawn as this panel.
export function LifeLine() {
  const t = useText();
  return (
    <div className="@container flex flex-col gap-3 rounded-control border border-signal bg-signal-tint p-3">
      <p className="flex items-start gap-3 text-body">
        <Icon name="phone" className="mt-0.5 text-signal" />
        <span>{t("notice.lifeLine")}</span>
      </p>
      <a href="tel:112" className={cn(buttonStyles({ variant: "signal", size: "main" }), "w-full @actions:w-auto")}>
        <Icon name="phone" />
        {t("notice.lifeLine.call")}
      </a>
    </div>
  );
}
