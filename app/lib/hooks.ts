import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigation } from "react-router";
import { INTENT } from "./turnForm";

// True while the form sent by the button with this name and value is on its way.
export function useBusy(value: string, name = INTENT): boolean {
  const navigation = useNavigation();
  return navigation.state !== "idle" && navigation.formData?.getAll(name).includes(value) === true;
}

// The browser honours autofocus on a heading when the page loads; a card that arrives later
// with script gets the same focus here, since React only autofocuses form controls.
export function useMountFocus<T extends HTMLElement>(when: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (when) ref.current?.focus();
  }, [when]);
  return ref;
}

// Moves focus to an element when the trigger changes after the first render. The first render
// needs nothing: the server marked the same element with autofocus.
export function useFocusOnChange(id: string | null, trigger: unknown): void {
  const last = useRef(trigger);
  useEffect(() => {
    if (last.current === trigger) return;
    last.current = trigger;
    if (id !== null) document.getElementById(id)?.focus();
  }, [trigger, id]);
}

// The value, settled for a moment, so a screen reader hears the last count and not every step.
export function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

// True until the given instant, then false: sending waits for a limit's retry time.
export function useWaitingUntil(untilMs: number | null): boolean {
  const [waiting, setWaiting] = useState(untilMs !== null && untilMs > Date.now());
  useEffect(() => {
    const left = untilMs === null ? 0 : untilMs - Date.now();
    setWaiting(left > 0);
    if (left <= 0) return;
    const timer = setTimeout(() => setWaiting(false), left);
    return () => clearTimeout(timer);
  }, [untilMs]);
  return waiting;
}

const noSubscribe = () => () => {};
// True once the page runs script; the server render and a page with no script draw without it.
export const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
