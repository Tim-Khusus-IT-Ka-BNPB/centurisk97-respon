import type { FieldStates, PlaceValue } from "./fieldState";
import type { FieldId } from "./fields/catalogue";

// How sure the desk can be of a report, decided when it is sent, so the right BPBD gets it at once
// and Pusdalops checks first only what needs checking. Code decides; the model is one signal among
// several, never the judge. A life at risk is never held back.

export const TRIAGE_TIERS = ["darurat", "tinggi", "sedang", "rendah"] as const;
export type TriageTier = (typeof TRIAGE_TIERS)[number];

// What the model may say worries it about a report.
export const MODEL_CONCERNS = ["test", "joke", "abuse", "notADisaster", "inconsistentHazard", "pastEvent"] as const;
export type ModelConcern = (typeof MODEL_CONCERNS)[number];

export type ModelJudgement = {
  readonly plausible: "likely" | "unsure" | "unlikely";
  readonly concerns: readonly ModelConcern[];
};

export type TriageSignals = {
  // The reporter said a life is at risk now, or someone is trapped, missing or badly hurt.
  readonly lifeAtRisk: boolean;
  // How the place is known: a phone's reading inside the village, a village searched by name, or a
  // reading with doubts (another time zone, abroad, a jump).
  readonly place: "gps" | "searched" | "doubted";
  // Photos from a camera, with their place on them.
  readonly livePhotos: number;
  // Other reporters of the same hazard in the same district in the last day.
  readonly otherReporters: number;
  // What the reporter's number sent before: a report handled, none, or one found not to be true.
  readonly history: "handled" | "none" | "invalid";
  readonly completePercent: number;
  // Null when the model was off, not asked or did not answer in time.
  readonly model: ModelJudgement | null;
};

export const TRIAGE_REASONS = [
  "lifeAtRisk",
  "gps",
  "searched",
  "doubted",
  "livePhoto",
  "otherReporters",
  "handledBefore",
  "invalidBefore",
  "detailed",
  "modelLikely",
  "modelUnsure",
  "modelUnlikely",
  "modelOff",
  ...MODEL_CONCERNS.map((concern) => `concern.${concern}` as const),
] as const;
export type TriageReason = (typeof TRIAGE_REASONS)[number];

export type Triage = {
  readonly tier: TriageTier;
  readonly score: number;
  readonly reasons: readonly TriageReason[];
  // Held for Pusdalops to check before any BPBD sees it.
  readonly held: boolean;
};

const BASE = 40;
const PLACE = { gps: 20, searched: 0, doubted: -20 } as const;
const PLACE_REASON = { gps: "gps", searched: "searched", doubted: "doubted" } as const;
const PLAUSIBLE = { likely: 10, unsure: 0, unlikely: -30 } as const;
const PLAUSIBLE_REASON = { likely: "modelLikely", unsure: "modelUnsure", unlikely: "modelUnlikely" } as const;
const CONCERN: Readonly<Record<ModelConcern, number>> = {
  test: -40,
  joke: -40,
  abuse: -40,
  notADisaster: -30,
  inconsistentHazard: -10,
  pastEvent: -5,
};
const TIER_FLOOR = { tinggi: 70, sedang: 40 } as const;

export function triage(signals: TriageSignals): Triage {
  const reasons: TriageReason[] = [];
  let score = BASE + PLACE[signals.place];
  reasons.push(PLACE_REASON[signals.place]);
  if (signals.livePhotos > 0) {
    score += 15;
    reasons.push("livePhoto");
  }
  if (signals.otherReporters > 0) {
    score += Math.min(signals.otherReporters, 2) * 10;
    reasons.push("otherReporters");
  }
  if (signals.history === "handled") {
    score += 10;
    reasons.push("handledBefore");
  } else if (signals.history === "invalid") {
    score -= 25;
    reasons.push("invalidBefore");
  }
  if (signals.completePercent >= 60) {
    score += 5;
    reasons.push("detailed");
  }
  if (signals.model === null) reasons.push("modelOff");
  else {
    score += PLAUSIBLE[signals.model.plausible];
    reasons.push(PLAUSIBLE_REASON[signals.model.plausible]);
    for (const concern of signals.model.concerns) {
      score += CONCERN[concern];
      reasons.push(`concern.${concern}`);
    }
  }
  score = Math.max(0, Math.min(100, score));
  if (signals.lifeAtRisk) return { tier: "darurat", score, reasons: ["lifeAtRisk", ...reasons], held: false };
  const tier = score >= TIER_FLOOR.tinggi ? "tinggi" : score >= TIER_FLOOR.sedang ? "sedang" : "rendah";
  // Without the model's word, a report is never held back on what code alone can see.
  return { tier, score, reasons, held: tier === "rendah" && signals.model !== null };
}

// A life at risk, as the report tells it: the emergency path, someone trapped, someone needing medical
// help now, or anyone missing.
export function lifeAtRiskOf(states: FieldStates, emergency: boolean): boolean {
  const value = (id: FieldId) => {
    const state = states[id];
    return state?.state === "value" ? state.value : null;
  };
  return (
    emergency ||
    ["seen", "heardOf"].includes(value("trapped") as string) ||
    ["seriousInjuries", "suddenIllness", "both"].includes(value("medicalHelp") as string) ||
    Number(value("missing")) > 0
  );
}

type SentPhoto = { readonly badge: string; readonly far: boolean; readonly doubts: readonly string[] };

// How the place is known: any photo's reading in doubt outweighs the rest; else a phone's reading
// inside the village, else a village searched by name.
export function placeSignal(states: FieldStates, photos: readonly SentPhoto[]): TriageSignals["place"] {
  if (photos.some((photo) => photo.doubts.length > 0)) return "doubted";
  const place = states.place;
  const precision = place?.state === "value" ? (place.value as PlaceValue).precision : null;
  return precision === "gpsPoint" ? "gps" : "searched";
}

// Photos from a camera with their place on them, taken near the reported place.
export const livePhotoCount = (photos: readonly SentPhoto[]): number =>
  photos.filter((photo) => photo.badge !== "none" && !photo.far).length;
