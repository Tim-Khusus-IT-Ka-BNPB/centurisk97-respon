import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useFocusOnChange, useSettled, useWaitingUntil } from "./hooks";

afterEach(() => vi.useRealTimers());

describe("page hooks", () => {
  test("focus moves only when the trigger changes after the first render", () => {
    document.body.innerHTML = '<input id="a" /><input id="b" />';
    const { rerender } = renderHook(({ id, trigger }) => useFocusOnChange(id, trigger), {
      initialProps: { id: "a" as string | null, trigger: 1 },
    });
    expect(document.activeElement).toBe(document.body);
    rerender({ id: "b", trigger: 2 });
    expect(document.activeElement?.id).toBe("b");
    rerender({ id: null, trigger: 3 });
    expect(document.activeElement?.id).toBe("b");
    (document.getElementById("a") as HTMLElement).focus();
    rerender({ id: "b", trigger: 3 });
    expect(document.activeElement?.id).toBe("a");
  });

  test("a value settles after its delay, so only the last count is heard", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useSettled(value, 300), { initialProps: { value: "1" } });
    rerender({ value: "2" });
    expect(result.current).toBe("1");
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe("2");
  });

  test("sending waits until the retry time, then opens", () => {
    vi.useFakeTimers();
    const now = Date.now();
    const { result, rerender } = renderHook(({ until }) => useWaitingUntil(until), {
      initialProps: { until: (now + 1000) as number | null },
    });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
    rerender({ until: now - 1 });
    expect(result.current).toBe(false);
    rerender({ until: null });
    expect(result.current).toBe(false);
  });
});
