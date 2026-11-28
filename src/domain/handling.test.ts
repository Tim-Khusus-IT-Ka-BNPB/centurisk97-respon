import { describe, expect, test } from "vitest";
import { checkActions, checkProof, PROOF } from "./handling";

const OFFERED = [
  { code: "evakuasi", label: "Evakuasi warga" },
  { code: "logistik", label: "Distribusi logistik" },
];

describe("what was done", () => {
  test("is picked from the hazard's actions, in their order, each once", () => {
    expect(checkActions(OFFERED, ["logistik", "evakuasi", "logistik"], "")).toEqual({ kind: "ok", actions: OFFERED });
  });

  test("or told in the officer's own words, trimmed", () => {
    expect(checkActions([], [], "  Sedot sumur ")).toEqual({
      kind: "ok",
      actions: [{ code: null, label: "Sedot sumur" }],
    });
    expect(checkActions(OFFERED, ["evakuasi"], "Sedot sumur")).toEqual({
      kind: "ok",
      actions: [OFFERED[0], { code: null, label: "Sedot sumur" }],
    });
  });

  test("none at all, or one not offered, is refused on the actions", () => {
    expect(checkActions(OFFERED, [], "  ")).toEqual({
      kind: "invalid",
      error: { fieldId: "actions", rule: "actions.none", params: {} },
    });
    expect(checkActions(OFFERED, ["evakuasi", "sar"], "")).toEqual({
      kind: "invalid",
      error: { fieldId: "actions", rule: "actions.unknown", params: {} },
    });
  });

  test("other words have 3 to 120 characters", () => {
    expect(checkActions(OFFERED, ["evakuasi"], "ok")).toEqual({
      kind: "invalid",
      error: { fieldId: "otherAction", rule: "staffText.tooShort", params: { label: "desk.actions.other", min: 3 } },
    });
    expect(checkActions(OFFERED, [], "oke")).toMatchObject({ kind: "ok" });
    expect(checkActions(OFFERED, [], "a".repeat(120))).toMatchObject({ kind: "ok" });
    expect(checkActions(OFFERED, [], "a".repeat(121))).toEqual({
      kind: "invalid",
      error: {
        fieldId: "otherAction",
        rule: "text.tooLong",
        params: { label: "desk.actions.other", length: 121, max: 120 },
      },
    });
  });
});

describe("a photo of the work", () => {
  const NOW = Date.parse("2026-11-24T03:00:00.000Z");
  const jpeg = (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.set([0xff, 0xd8]);
    return bytes;
  };
  const fix = { lat: 5.1, lon: 97, accuracyM: 20, readAtMs: NOW - 60_000 };
  const exif = { camera: true, time: null, point: null } as never;
  const input = { bytes: jpeg(1000), exif, nowMs: NOW, device: fix, count: 0, forwarded: false };

  test("from a camera is kept with the officer's reading when it is good enough", () => {
    expect(checkProof(input)).toEqual({ kind: "kept", fix });
    expect(checkProof({ ...input, device: null })).toEqual({ kind: "kept", fix: null });
    expect(checkProof({ ...input, device: { ...fix, accuracyM: 1001 } })).toEqual({ kind: "kept", fix: null });
    expect(checkProof({ ...input, device: { ...fix, readAtMs: NOW - 11 * 60_000 } })).toEqual({
      kind: "kept",
      fix: null,
    });
  });

  test("not a JPEG, too small or over 3 MB is refused", () => {
    expect(PROOF.maxBytes).toBe(3 * 1024 * 1024);
    for (const bytes of [new Uint8Array(1000), jpeg(999), jpeg(PROOF.maxBytes + 1)])
      expect(checkProof({ ...input, bytes })).toEqual({ kind: "refused", rule: "proofFormat" });
    expect(checkProof({ ...input, bytes: jpeg(PROOF.maxBytes) })).toMatchObject({ kind: "kept" });
  });

  test("a screenshot or a file with no camera data is refused", () => {
    expect(checkProof({ ...input, exif: null })).toEqual({ kind: "refused", rule: "proofNotCamera" });
    expect(checkProof({ ...input, exif: { camera: false, time: null, point: null } as never })).toEqual({
      kind: "refused",
      rule: "proofNotCamera",
    });
  });

  test("one marked forwarded needs no camera data and keeps no reading, but is still a JPEG of the size", () => {
    const forwarded = { ...input, forwarded: true };
    expect(checkProof({ ...forwarded, exif: null })).toEqual({ kind: "kept", fix: null });
    expect(checkProof({ ...forwarded, exif: { camera: false, time: null, point: null } as never })).toEqual({
      kind: "kept",
      fix: null,
    });
    expect(checkProof(forwarded)).toEqual({ kind: "kept", fix: null });
    for (const bytes of [new Uint8Array(1000), jpeg(999), jpeg(PROOF.maxBytes + 1)])
      expect(checkProof({ ...forwarded, bytes })).toEqual({ kind: "refused", rule: "proofFormat" });
    expect(checkProof({ ...forwarded, count: 10 })).toEqual({ kind: "refused", rule: "proofTooMany" });
  });

  test("a report holds 10", () => {
    expect(checkProof({ ...input, count: 9 })).toMatchObject({ kind: "kept" });
    expect(checkProof({ ...input, count: 10 })).toEqual({ kind: "refused", rule: "proofTooMany" });
  });
});
