import { useEffect, useSyncExternalStore } from "react";
import {
  type AlarmState,
  alarmState,
  askForAlarm,
  notificationsBlocked,
  onAlarmChange,
  wakeOnGesture,
} from "../../../lib/alarm";
import { useText } from "../../../lib/text";
import { Icon } from "../../atoms/Icon";

// Before the page runs script there is nothing to turn on.
const unknown = (): AlarmState => "none";

// The emergency alarm, turned on from the menu before any emergency comes. After a reload the
// notifications still come; the sound waits for one click, on this button or anywhere on the page.
export function AlarmSwitch() {
  const t = useText();
  const state = useSyncExternalStore(onAlarmChange, alarmState, unknown);
  useEffect(() => wakeOnGesture(), []);
  if (state === "none") return null;
  if (state === "on")
    return (
      <p role="status" className="flex items-start gap-3 px-3 py-1.5 text-meta">
        <Icon name="bell" className="text-primary" />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{t("desk.alarm.on")}</span>
          {notificationsBlocked() ? <span className="text-muted">{t("desk.alarm.blocked")}</span> : null}
        </span>
      </p>
    );
  return (
    <button
      type="button"
      className="flex min-h-target-min w-full items-start gap-3 rounded-control px-3 py-2 text-start text-ink hover:bg-sunken"
      onClick={() => void askForAlarm()}
    >
      <Icon name="bellOff" className="mt-0.5 text-muted" />
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{t(state === "off" ? "desk.alarm.turnOn" : "desk.alarm.wake")}</span>
        <span className="text-meta text-muted">
          {t(state === "off" ? "desk.alarm.turnOnHint" : "desk.alarm.wakeHint")}
        </span>
      </span>
    </button>
  );
}
