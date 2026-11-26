// Node 22 and later carry a localStorage of their own which, given no file, stands in front of
// jsdom's. The app tests use the browser's, as the phone does.
const { jsdom } = globalThis as unknown as { jsdom: { window: Window } };
Object.defineProperty(globalThis, "localStorage", { value: jsdom.window.localStorage, configurable: true });
