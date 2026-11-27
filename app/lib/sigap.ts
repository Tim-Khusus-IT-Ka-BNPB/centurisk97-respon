// Sigap, the BNPB officer mascot (upstream K76, maskot.js): the owner's renders played as short
// scenes, each frame a file and how long it shows. A scene plays twice and rests on its first frame
// (WCAG 2.2.2); a tap plays the greeting once and the scene again.
export type SigapFrame = readonly [file: string, ms: number];

const WAVE: readonly SigapFrame[] = [
  ["lambai2", 240],
  ["lambai", 240],
  ["lambai2", 240],
  ["lambai", 1800],
];

export const SIGAP_SCENES = {
  greet: [["lambai", 1400], ...WAVE, ["jempol", 3200], ["lambai", 1000], ...WAVE],
  cheer: [["semangat", 2600], ["lambai", 900], ...WAVE, ["jempol", 2600]],
  glad: [["senang", 2600], ["jempol", 2600], ["lambai", 900], ...WAVE],
  // Grief: one concerned face, no wave, no laugh.
  sorry: [["sedih", 0]],
  think: [
    ["pikir", 3200],
    ["ide", 2800],
  ],
  emergency: [
    ["ht", 2600],
    ["tegas", 2400],
    ["ht2", 2600],
  ],
  numbers: [
    ["ht3", 2800],
    ["tunjuk", 2600],
  ],
  warning: [
    ["teropong", 2800],
    ["stop", 2600],
  ],
  report: [
    ["hp", 2800],
    ["tablet", 2800],
  ],
  reports: [
    ["tablet", 2800],
    ["status", 2800],
  ],
  learn: [
    ["ide", 2800],
    ["pikir", 2800],
  ],
  missing: [
    ["cari", 2800],
    ["teropong", 2800],
  ],
  info: [
    ["tunjuk", 2800],
    ["ide", 2600],
  ],
  language: [
    ["sapa", 2600],
    ["tunjukkiri", 2600],
  ],
} as const satisfies Record<string, readonly SigapFrame[]>;

export type SigapScene = keyof typeof SIGAP_SCENES;

export const SIGAP_TAPPED: readonly SigapFrame[] = [["semangat", 1400], ["lambai", 500], ...WAVE];
export const SIGAP_LOOPS = 2;

export const sigapSrc = (file: string) => `/sigap/${file}.webp`;

// The two waving renders share one body: between them only the hand moves, so no hop.
export const sameBody = (a: string, b: string) => a.startsWith("lambai") && b.startsWith("lambai");
