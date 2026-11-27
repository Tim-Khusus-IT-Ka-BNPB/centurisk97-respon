import { Form, Link, useNavigation } from "react-router";
import type { DeskReport } from "../../../../src/contract/desk";
import { TODAY_CONDITIONS } from "../../../../src/domain/todayPage";
import { cn } from "../../../lib/cn";
import { useText } from "../../../lib/text";
import { Button } from "../../atoms/Button";
import { Icon } from "../../atoms/Icon";

type Today = NonNullable<DeskReport["today"]>;

// The five conditions for the public today page, each met or not (upstream LK-07), and the pull
// that takes the report's event off it or puts it back (D8).
export function DeskToday({ today }: { readonly today: Today }) {
  const t = useText();
  const navigation = useNavigation();
  const busy = navigation.formData?.get("action") === "today";
  const pulled = !today.conditions.pull;
  return (
    <div className="flex flex-col gap-3">
      <p className={cn("font-semibold", today.shown ? "text-primary" : "text-muted")}>
        {t(today.shown ? "desk.today.shown" : "desk.today.hidden")}
      </p>
      <ul className="flex flex-col gap-1.5">
        {TODAY_CONDITIONS.map((condition) => {
          const met = today.conditions[condition];
          return (
            <li key={condition} className="flex items-start gap-2">
              <Icon
                name={met ? "circleCheck" : "circleX"}
                className={cn("mt-0.5 size-4 shrink-0", met ? "text-primary" : "text-danger")}
              />
              <span>
                {t(`desk.today.${condition}`)}
                <span className="sr-only">{t(met ? "desk.today.met" : "desk.today.unmet")}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Form method="post" replace preventScrollReset>
          <input type="hidden" name="action" value="today" />
          <input type="hidden" name="pulled" value={pulled ? "0" : "1"} />
          <Button variant="secondary" size="min" busyLabel={busy ? t("desk.today.busy") : null}>
            {t(pulled ? "desk.today.restore" : "desk.today.pullOff")}
          </Button>
        </Form>
        <Link to="/lapor/hari-ini" className="font-semibold text-primary">
          {t("desk.today.open")}
        </Link>
      </div>
    </div>
  );
}
