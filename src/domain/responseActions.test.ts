import { describe, expect, test } from "vitest";
import { HAZARD_TYPE_IDS } from "./hazards";
import { actionsFor, checkActionFile } from "./responseActions";

const FILE = {
  versi: 1,
  tindakan: { evakuasi: "Evakuasi warga", logistik: "Distribusi logistik" },
  bencana: [
    { id: "banjir", kemampuan: { tindakan: ["evakuasi", "logistik", "hilang"] } },
    { id: "karhutla", kemampuan: { tindakan: [] } },
    { id: "udara" },
    { id: "pesisir", kemampuan: {} },
    { id: "longsor", kemampuan: { tindakan: ["logistik"] } },
    { id: "cuaca", kemampuan: { tindakan: ["evakuasi"] } },
    { id: "kekeringan", kemampuan: { tindakan: ["logistik"] } },
    { id: "gempa", kemampuan: { tindakan: ["evakuasi"] } },
    { id: "gunungapi", kemampuan: { tindakan: ["evakuasi"] } },
  ],
};

describe("the action file", () => {
  test("is taken whole when it keeps its contract", () => {
    expect(checkActionFile(FILE)).toBe(FILE);
  });

  test.each([
    ["nothing", null],
    ["a list", []],
    ["no version", { ...FILE, versi: undefined }],
    ["a version that is not a whole number", { ...FILE, versi: 1.5 }],
    ["no labels", { ...FILE, tindakan: undefined }],
    ["labels as a list", { ...FILE, tindakan: ["evakuasi"] }],
    ["labels as null", { ...FILE, tindakan: null }],
    ["no label at all", { ...FILE, tindakan: {} }],
    ["an empty label", { ...FILE, tindakan: { evakuasi: " " } }],
    ["a label that is not text", { ...FILE, tindakan: { evakuasi: "Evakuasi", logistik: 2 } }],
    ["no hazards", { ...FILE, bencana: undefined }],
    ["a hazard that is null", { ...FILE, bencana: [{ id: "banjir" }, null] }],
    ["a hazard with an empty id", { ...FILE, bencana: [{ id: "" }] }],
    ["a hazard with no id", { ...FILE, bencana: [{ kemampuan: {} }] }],
    ["actions that are not a list", { ...FILE, bencana: [{ id: "banjir", kemampuan: { tindakan: "evakuasi" } }] }],
    ["an action that is not text", { ...FILE, bencana: [{ id: "banjir", kemampuan: { tindakan: ["a", 1] } }] }],
  ])("is refused with %s", (_name, json) => {
    expect(checkActionFile(json)).toBeNull();
  });
});

describe("a hazard's actions", () => {
  test("come in the registry's order, a code with no label left out", () => {
    expect(actionsFor(FILE, "flood")).toEqual([
      { code: "evakuasi", label: "Evakuasi warga" },
      { code: "logistik", label: "Distribusi logistik" },
    ]);
  });

  test("each hazard reads its own entry; one with no entry, no list or an empty one has none", () => {
    const counts = Object.fromEntries(HAZARD_TYPE_IDS.map((id) => [id, actionsFor(FILE, id).map((one) => one.code)]));
    expect(counts).toEqual({
      flood: ["evakuasi", "logistik"],
      landslide: ["logistik"],
      tidalWaveAbrasion: [],
      extremeWeather: ["evakuasi"],
      drought: ["logistik"],
      forestFire: [],
      earthquake: ["evakuasi"],
      tsunami: [],
      volcanicEruption: ["evakuasi"],
      buildingFire: [],
      other: [],
    });
    const coast = { ...FILE, bencana: [{ id: "pesisir", kemampuan: { tindakan: ["logistik"] } }] };
    expect(actionsFor(coast, "tidalWaveAbrasion")).toHaveLength(1);
    expect(actionsFor(coast, "tsunami")).toHaveLength(1);
    const fire = { ...FILE, bencana: [{ id: "karhutla", kemampuan: { tindakan: ["logistik"] } }] };
    expect(actionsFor(fire, "forestFire")).toHaveLength(1);
  });

  test("an entry that names no actions has none", () => {
    expect(actionsFor({ ...FILE, bencana: [{ id: "banjir" }] }, "flood")).toEqual([]);
  });

  test("with no file there are none", () => {
    expect(actionsFor(null, "flood")).toEqual([]);
  });
});
