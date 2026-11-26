import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderPage } from "../../../testing/render";
import { browserSeconds, VideoUpload } from "./VideoUpload";

const DRAFT = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const BASE = `/api/lapor/drafts/${DRAFT}/videos`;
const PART = 4;
const KEPT = [{ id: ID, seconds: 13, container: "mp4" }];
const progress = (received: number[]) => ({ id: ID, parts: 2, partBytes: PART, received });

type Answer = { status: number; body?: unknown } | "drop";
const calls: string[] = [];
// Answers by method and path; a list of answers is used in turn, its last one kept.
function answer(routes: Record<string, Answer | Answer[]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push(key);
      const found = routes[key];
      const next = Array.isArray(found) ? (found.length > 1 ? found.shift() : found[0]) : found;
      if (next === undefined) return new Response("{}", { status: 404 });
      if (next === "drop") throw new TypeError("network lost");
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
    }),
  );
}

const draw = () =>
  renderPage(<VideoUpload draftId={DRAFT} readSeconds={async () => 12.5} retryMs={0} />, { path: "/lapor/report/d" });
// The picker shows once the kept videos are read; a busy machine may take a moment.
const pick = async (bytes = 6) =>
  fireEvent.change(await screen.findByLabelText("Rekam video", {}, { timeout: 5000 }), {
    target: { files: [new File([new Uint8Array(bytes)], "kejadian.mp4", { type: "video/mp4" })] },
  });
const invalid = (copyKey: string) => ({
  status: 422,
  body: {
    error: { code: "request.invalidFields", copyKey: "error.request.invalidFields", params: {} },
    fields: [{ fieldId: "video", copyKey, params: {} }],
  },
});

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("a video of the scene", () => {
  test("sent part by part with its length, made whole, kept and taken back", async () => {
    answer({
      [`GET ${BASE}`]: { status: 200, body: [] },
      [`POST ${BASE}`]: { status: 200, body: progress([]) },
      [`PUT ${BASE}/${ID}/parts/0`]: { status: 200, body: progress([0]) },
      [`PUT ${BASE}/${ID}/parts/1`]: { status: 200, body: progress([0, 1]) },
      [`POST ${BASE}/${ID}/complete`]: { status: 200, body: KEPT },
      [`DELETE ${BASE}/${ID}`]: { status: 200, body: [] },
    });
    draw();
    await waitFor(() => expect(calls).toContain(`GET ${BASE}`));
    // The picker closed with nothing picked: nothing is sent.
    fireEvent.change(screen.getByLabelText("Rekam video"), { target: { files: [] } });
    await pick();
    expect(await screen.findByText("Video 1, 13 detik")).toBeTruthy();
    expect(calls).toEqual([
      `GET ${BASE}`,
      `POST ${BASE}`,
      `PUT ${BASE}/${ID}/parts/0`,
      `PUT ${BASE}/${ID}/parts/1`,
      `POST ${BASE}/${ID}/complete`,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.queryByText("Video 1, 13 detik")).toBeNull());
  });

  test("a line that breaks after three tries says how much landed; Lanjutkan sends only the rest", async () => {
    answer({
      [`GET ${BASE}`]: { status: 200, body: [] },
      [`POST ${BASE}`]: { status: 200, body: progress([]) },
      [`PUT ${BASE}/${ID}/parts/0`]: { status: 200, body: progress([0]) },
      [`PUT ${BASE}/${ID}/parts/1`]: [
        "drop",
        { status: 503, body: {} },
        "drop",
        { status: 200, body: progress([0, 1]) },
      ],
      [`GET ${BASE}/${ID}`]: { status: 200, body: progress([0]) },
      [`POST ${BASE}/${ID}/complete`]: { status: 200, body: KEPT },
    });
    draw();
    await waitFor(() => expect(calls).toContain(`GET ${BASE}`));
    await pick();
    expect(await screen.findByText("Sinyal putus. 1 dari 2 bagian sudah sampai.")).toBeTruthy();
    expect(calls.filter((call) => call.endsWith("/parts/1"))).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Lanjutkan mengirim" }));
    expect(await screen.findByText("Video 1, 13 detik")).toBeTruthy();
    expect(calls.filter((call) => call.endsWith("/parts/0"))).toHaveLength(1);
  });

  test("a refusal is named: on the start, on a part, or on the whole; a dropped finish can be continued", async () => {
    answer({ [`GET ${BASE}`]: { status: 200, body: [] }, [`POST ${BASE}`]: invalid("fieldError.video.tooBig") });
    const view = draw();
    await waitFor(() => expect(calls).toContain(`GET ${BASE}`));
    await pick();
    expect(await screen.findByText(/^Video paling besar 30 MB/)).toBeTruthy();
    view.unmount();
    answer({
      [`GET ${BASE}`]: { status: 200, body: [] },
      [`POST ${BASE}`]: { status: 200, body: progress([]) },
      [`PUT ${BASE}/${ID}/parts/0`]: invalid("fieldError.video.partCut"),
    });
    const second = draw();
    await waitFor(() => expect(calls).toContain(`GET ${BASE}`));
    await pick();
    expect(await screen.findByText(/^Sebagian video terpotong/)).toBeTruthy();
    second.unmount();
    answer({
      [`GET ${BASE}`]: { status: 200, body: [] },
      [`POST ${BASE}`]: { status: 200, body: progress([0, 1]) },
      [`POST ${BASE}/${ID}/complete`]: ["drop", invalid("fieldError.video.notVideo")],
      [`GET ${BASE}/${ID}`]: [{ status: 200, body: progress([0, 1]) }, invalid("fieldError.video.partsMissing")],
    });
    const third = draw();
    await waitFor(() => expect(calls).toContain(`GET ${BASE}`));
    await pick();
    fireEvent.click(await screen.findByRole("button", { name: "Lanjutkan mengirim" }));
    expect(await screen.findByText("Berkas ini bukan video MP4, MOV, atau WebM.")).toBeTruthy();
    third.unmount();
    answer({ [`GET ${BASE}`]: "drop", [`POST ${BASE}`]: "drop" });
    draw();
    await screen.findByLabelText("Rekam video");
    await pick();
    expect(await screen.findByText(/^Video belum terkirim/)).toBeTruthy();
  });

  test("three kept: no more to record; a resume that cannot read the upload says so", async () => {
    answer({
      [`GET ${BASE}`]: { status: 200, body: [1, 2, 3].map((n) => ({ ...KEPT[0], id: `${ID.slice(0, -1)}${n}` })) },
    });
    const view = draw();
    expect(await screen.findByText("Video 3, 13 detik")).toBeTruthy();
    expect(screen.queryByLabelText("Rekam video")).toBeNull();
    // A take-back the service refuses leaves the list as it was.
    fireEvent.click(screen.getAllByRole("button", { name: "Hapus" })[0] as HTMLElement);
    await waitFor(() => expect(calls.some((call) => call.startsWith("DELETE"))).toBe(true));
    expect(screen.getByText("Video 3, 13 detik")).toBeTruthy();
    view.unmount();
    answer({
      [`GET ${BASE}`]: { status: 200, body: [] },
      [`POST ${BASE}`]: { status: 200, body: progress([]) },
      [`PUT ${BASE}/${ID}/parts/0`]: "drop",
      [`GET ${BASE}/${ID}`]: [
        "drop",
        "drop",
        {
          status: 404,
          body: { error: { code: "draft.notFound", copyKey: "error.draft.notFound", params: {} }, fields: [] },
        },
      ],
    });
    draw();
    await waitFor(() => expect(calls).toContain(`GET ${BASE}`));
    await pick();
    fireEvent.click(await screen.findByRole("button", { name: "Lanjutkan mengirim" }));
    fireEvent.click(await screen.findByRole("button", { name: "Lanjutkan mengirim" }));
    expect(await screen.findByText(/./, { selector: "p.text-danger" })).toBeTruthy();
  });
});

describe("the length the phone's player reads", () => {
  test("its duration, none when it is not a number, and none on an error or after 3 seconds", async () => {
    const made: { onloadedmetadata?: () => void; onerror?: () => void; duration?: number }[] = [];
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((name: string) => {
      if (name !== "video") return create(name);
      const fake = {} as { onloadedmetadata?: () => void; onerror?: () => void; duration?: number };
      made.push(fake);
      return fake as unknown as HTMLVideoElement;
    });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    const file = new File([new Uint8Array(4)], "a.webm");
    const read = browserSeconds(file);
    Object.assign(made[0] as object, { duration: 41.2 });
    made[0]?.onloadedmetadata?.();
    expect(await read).toBe(41.2);
    const endless = browserSeconds(file);
    Object.assign(made[1] as object, { duration: Number.POSITIVE_INFINITY });
    made[1]?.onloadedmetadata?.();
    expect(await endless).toBeNull();
    const broken = browserSeconds(file);
    made[2]?.onerror?.();
    expect(await broken).toBeNull();
    vi.useFakeTimers();
    const slow = browserSeconds(file);
    vi.advanceTimersByTime(3000);
    expect(await slow).toBeNull();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
