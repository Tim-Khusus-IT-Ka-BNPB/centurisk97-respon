// Upstream's hazard registry (public/bencana.json), of which only the response actions are read:
// each action's label by its code, and per hazard the codes its logbook uses (D111). No imports,
// so the Node import scripts share this contract.

type HazardEntry = { readonly id: string; readonly kemampuan?: { readonly tindakan?: readonly string[] } };

export type ActionFile = {
  readonly versi: number;
  readonly tindakan: Readonly<Record<string, string>>;
  readonly bencana: readonly HazardEntry[];
};

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const isEntry = (value: unknown): value is HazardEntry => {
  const entry = value as Partial<HazardEntry> | null;
  const codes = entry?.kemampuan?.tindakan;
  return isText(entry?.id) && (codes === undefined || (Array.isArray(codes) && codes.every(isText)));
};

// The file as its contract says, or null. No action at all is a broken export.
export function checkActionFile(json: unknown): ActionFile | null {
  const file = json as Partial<ActionFile> | null;
  if (file === null || !Number.isInteger(file.versi)) return null;
  const labels = file.tindakan;
  if (Object.getPrototypeOf(labels ?? 0) !== Object.prototype) return null;
  const entries = Object.values(labels as object);
  if (entries.length === 0 || !entries.every(isText)) return null;
  return Array.isArray(file.bencana) && file.bencana.every(isEntry) ? (file as ActionFile) : null;
}

// Upstream's registry id for each hazard type (JENIS_REGISTRI). A type with none takes only an
// action in the officer's own words.
const REGISTRY: Readonly<Record<string, string>> = {
  flood: "banjir",
  landslide: "longsor",
  tidalWaveAbrasion: "pesisir",
  extremeWeather: "cuaca",
  drought: "kekeringan",
  forestFire: "karhutla",
  earthquake: "gempa",
  tsunami: "pesisir",
  volcanicEruption: "gunungapi",
};

export type ResponseAction = { readonly code: string; readonly label: string };

// The actions of a hazard type in the registry's order; a code with no label is left out.
export function actionsFor(file: ActionFile | null, hazardType: string): ResponseAction[] {
  if (file === null) return [];
  const entry = file.bencana.find((one) => one.id === REGISTRY[hazardType]);
  return [...new Set(entry?.kemampuan?.tindakan)].flatMap((code) => {
    const label = file.tindakan[code];
    return label === undefined ? [] : [{ code, label }];
  });
}
