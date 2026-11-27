import { cleanup, type RenderResult, render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type ActionFunction, createRoutesStub, type LoaderFunction } from "react-router";
import { afterEach } from "vitest";
import type { DraftBody } from "../../src/contract/draft";
import type { ErrorEnvelope } from "../../src/contract/errors";
import { copy } from "../../src/copy";
import { makeText } from "../../src/copy/text";
import { DraftContext, type DraftView } from "../components/organisms/cards/CardShell";
import { TextContext } from "../lib/text";
import type { Posted } from "../lib/turnForm";

afterEach(() => cleanup());

// Every key of the catalogue, so a component under test reads real copy.
export const ALL_TEXTS = Object.fromEntries(copy.keys.map((key) => [key, copy.text(key)]));

export const text = makeText(ALL_TEXTS);

type Options = {
  readonly path?: string;
  // The address the page opens at, when it carries a query the route path does not.
  readonly entry?: string;
  readonly action?: ActionFunction;
  readonly loader?: LoaderFunction;
  // What stands in for the page when it cannot be shown.
  readonly errorBoundary?: ComponentType;
};

// An answer that never comes, to look at a page while its form is on the way.
export const never = () => new Promise<never>(() => undefined);

// The page under test. Tests in one file run one after another, so one slot is enough.
let current: ReactNode = null;
const Host = () => <TextContext.Provider value={text}>{current}</TextContext.Provider>;
const Nothing = () => null;

// Draws a component inside a router and the copy, as a page would.
export function renderPage(
  ui: ReactNode,
  { path = "/report/d", entry, action, loader, errorBoundary }: Options = {},
): RenderResult {
  current = ui;
  const Stub = createRoutesStub([
    {
      path,
      Component: Host,
      action: action ?? Nothing,
      loader: loader ?? Nothing,
      HydrateFallback: Nothing,
      ErrorBoundary: errorBoundary,
    },
    { path: "*", Component: Nothing },
  ]);
  return render(<Stub initialEntries={[entry ?? path]} />);
}

type DraftOptions = Options & {
  readonly envelope?: ErrorEnvelope | null;
  readonly posted?: Posted | null;
  readonly networkLost?: boolean;
  readonly lifeLine?: boolean;
  readonly turnKey?: string;
};

function draftView(draft: DraftBody, options: DraftOptions = {}): DraftView {
  return {
    draft,
    turnKey: options.turnKey ?? "00000000-0000-4000-8000-000000000001",
    envelope: options.envelope ?? null,
    posted: options.posted ?? null,
    networkLost: options.networkLost ?? false,
    lifeLine: options.lifeLine ?? false,
    origin: "http://localhost:5173",
  };
}

// Draws a card inside its draft page's context.
export function renderDraft(ui: ReactNode, draft: DraftBody, options: DraftOptions = {}): RenderResult {
  return renderPage(<DraftContext.Provider value={draftView(draft, options)}>{ui}</DraftContext.Provider>, options);
}
