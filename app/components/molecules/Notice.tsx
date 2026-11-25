import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useText } from "../../lib/text";
import { buttonStyles } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import type { IconName } from "../atoms/icons";

type NoticeKind = "info" | "refusal" | "limit" | "danger" | "error";

const LOOK: Readonly<Record<NoticeKind, { panel: string; icon: IconName; iconColour: string }>> = {
  info: { panel: "bg-sunken", icon: "info", iconColour: "text-ink" },
  refusal: { panel: "bg-sunken", icon: "messageCircleX", iconColour: "text-ink" },
  limit: { panel: "bg-sunken", icon: "clock", iconColour: "text-ink" },
  danger: { panel: "bg-warn-tint", icon: "triangleAlert", iconColour: "text-warn-icon" },
  error: { panel: "bg-danger-tint text-danger", icon: "circleAlert", iconColour: "text-danger" },
};

// A tinted panel with an icon and words: the state is never carried by colour alone.
export function Notice({ kind, children }: { readonly kind: NoticeKind; readonly children: ReactNode }) {
  const look = LOOK[kind];
  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      className={cn("flex items-start gap-3 rounded-control p-3.5 text-body", look.panel)}
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
    <div className="@container rounded-control bg-signal-tint p-3">
      <div className="flex flex-col gap-3 @actions:flex-row @actions:items-center @actions:justify-between">
        <p className="text-body">{t("notice.lifeLine")}</p>
        <a href="tel:112" className={cn(buttonStyles({ variant: "signal", size: "min" }), "shrink-0")}>
          <Icon name="phone" />
          {t("notice.lifeLine.call")}
        </a>
      </div>
    </div>
  );
}
