import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SIGAP_SCENES, SIGAP_TAPPED } from "../../lib/sigap";
import { TextContext } from "../../lib/text";
import { text } from "../../testing/render";
import { Sigap, SigapSays } from "./Sigap";

const drawn = () => screen.getByRole("button", { name: "Sapa Sigap" }).querySelector("img")?.getAttribute("src");
const motion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce") }));
const draw = (ui: React.ReactNode) => render(<TextContext.Provider value={text}>{ui}</TextContext.Provider>);
const wait = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Sigap", () => {
  test("plays its scene twice, each frame for its time, then rests on the first", async () => {
    motion(false);
    draw(<Sigap scene="think" />);
    await wait(0);
    expect(drawn()).toBe("/sigap/pikir.webp");
    const [[, think], [, idea]] = SIGAP_SCENES.think;
    await wait(think);
    expect(drawn()).toBe("/sigap/ide.webp");
    await wait(idea);
    expect(drawn()).toBe("/sigap/pikir.webp");
    await wait(think + idea);
    // Twice through: it stays on its first frame, breathing stopped.
    await wait(think * 3);
    expect(drawn()).toBe("/sigap/pikir.webp");
    expect(screen.getByRole("button").querySelector(".sigap-breathe")).toBeNull();
  });

  test("a tap greets back, then plays the scene again; a change of body hops, a waving hand does not", async () => {
    motion(false);
    draw(<Sigap scene="think" />);
    await wait(0);
    fireEvent.click(screen.getByRole("button", { name: "Sapa Sigap" }));
    expect(drawn()).toBe("/sigap/semangat.webp");
    expect(screen.getByRole("button").querySelector("img")?.className).toContain("sigap-hop");
    await wait((SIGAP_TAPPED[0] as readonly [string, number])[1]);
    expect(drawn()).toBe("/sigap/lambai.webp");
    await wait((SIGAP_TAPPED[1] as readonly [string, number])[1]);
    expect(drawn()).toBe("/sigap/lambai2.webp");
    expect(screen.getByRole("button").querySelector("img")?.className).not.toContain("sigap-hop");
    for (const [, ms] of SIGAP_TAPPED.slice(2)) await wait(ms);
    expect(drawn()).toBe("/sigap/pikir.webp");
  });

  test("with motion reduced, or a scene of one frame, it stays still", async () => {
    motion(true);
    draw(<Sigap scene="greet" />);
    await wait(10_000);
    expect(drawn()).toBe("/sigap/lambai.webp");
    expect(screen.getByRole("button").querySelector(".sigap-breathe")).toBeNull();
  });
});

test("Sigap says the page's word in a bubble beside it", () => {
  motion(false);
  draw(
    <SigapSays scene="sorry" title="Turut prihatin" text="Utamakan keselamatan.">
      <a href="tel:112">112</a>
    </SigapSays>,
  );
  expect(screen.getByText("Turut prihatin")).toBeTruthy();
  expect(screen.getByText("Utamakan keselamatan.")).toBeTruthy();
  expect(drawn()).toBe("/sigap/sedih.webp");
});
