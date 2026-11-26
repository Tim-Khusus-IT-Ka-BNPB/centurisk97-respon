import { describe, expect, test } from "vitest";
import type { ForecastFile, Level } from "./forecast";
import { HOUR_MS } from "./time";
import {
  ALL_HAZARDS,
  heldAtNight,
  pushEndpointOk,
  pushKeysOk,
  type Rise,
  riseFor,
  risenWarnings,
  sentKey,
  WARNING_HAZARDS,
} from "./warnings";

describe("a phone's push", () => {
  test.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://android.googleapis.com/gcm/send/abc",
    "https://web.push.apple.com/QGx",
    "https://api.push.apple.com/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://push.apple.com/x",
    "https://notify.windows.com/x",
    "https://push.services.mozilla.com/x",
    `https://fcm.googleapis.com/${"a".repeat(1000 - 27)}`,
  ])("%s is a push service", (endpoint) => {
    expect(pushEndpointOk(endpoint)).toBe(true);
  });

  test.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.example.test/x",
    "https://evilpush.apple.com.example.test/x",
    "https://notpush.apple.comx/x",
    "https://example.test/fcm.googleapis.com",
    "not an address",
    `https://fcm.googleapis.com/${"a".repeat(1000 - 26)}`,
    "https://xfcm.googleapis.com/x",
    "https://xandroid.googleapis.com/x",
    "https://android.googleapis.com.example.test/x",
    "https://web.push.apple.com.example.test/x",
    "https://x.notify.windows.com.example.test/x",
    "https://updates.push.services.mozilla.com.example.test/x",
  ])("%s is not", (endpoint) => {
    expect(pushEndpointOk(endpoint)).toBe(false);
  });

  test("the phone's keys are base64url of the browser's lengths", () => {
    const p256dh = "B".repeat(87);
    expect(pushKeysOk(p256dh, "a".repeat(22))).toBe(true);
    expect(pushKeysOk("B".repeat(80), "a".repeat(20))).toBe(true);
    expect(pushKeysOk("B".repeat(100), "a".repeat(30))).toBe(true);
    expect(pushKeysOk("B".repeat(79), "a".repeat(22))).toBe(false);
    expect(pushKeysOk("B".repeat(101), "a".repeat(22))).toBe(false);
    expect(pushKeysOk(p256dh, "a".repeat(19))).toBe(false);
    expect(pushKeysOk(p256dh, "a".repeat(31))).toBe(false);
    expect(pushKeysOk(`${"B".repeat(86)}=`, "a".repeat(22))).toBe(false);
    expect(pushKeysOk(p256dh, `${"a".repeat(21)}+`)).toBe(false);
  });

  test("every hazard is one bit, and all of them make the whole choice", () => {
    expect(WARNING_HAZARDS.reduce((sum, [, bit]) => sum | bit, 0)).toBe(ALL_HAZARDS);
  });
});

const FILE: ForecastFile = {
  dibuat: "2026-11-26T06:00:00+07:00",
  kode: {
    HJN: { label: "Hujan", hari: ["2026-11-26", "2026-11-27", "2026-11-28"], kol: ["tot"] },
    BNJ: { label: "Banjir", hari: ["2026-11-26", "2026-11-27", "2026-11-28"], kol: ["lv", "ps"] },
    ASP: { label: "Asap", hari: ["2026-11-26", "2026-11-27", "2026-11-28"], kol: ["kat"] },
    LSR: { label: "Longsor", hari: ["2026-11-25", "2026-11-26", "2026-11-27"], kol: ["lv"] },
  },
  kab: [
    {
      id: "1108",
      nama: "Kab. Aceh Utara",
      pn: "Aceh",
      HJN: [[1], [1], [1]],
      BNJ: [
        [2, 0.4],
        [1, 0.2],
        [0, 0],
      ],
      ASP: [[null], [3], [0]],
      LSR: [[3], [0], [1]],
    },
    { id: "3201", nama: "Kab. Bogor", pn: "Jawa Barat", HJN: [[1], [1], [1]] },
  ],
  waspada: [],
};
// 26 November, 10.00 WIB.
const NOW = Date.UTC(2026, 10, 26, 3);
const rise = (hazard: string, date: string, level: Level): Rise => ({
  regencyCode: "11.08",
  regencyName: "Kab. Aceh Utara",
  hazard,
  date,
  level,
});

describe("when a warning goes out", () => {
  test("each level above Normal from today on, by the file's own rules; days past and blanks never", () => {
    expect(risenWarnings(FILE, new Map(), NOW)).toEqual([
      rise("BNJ", "2026-11-26", 2),
      rise("BNJ", "2026-11-27", 1),
      rise("LSR", "2026-11-27", 1),
      rise("ASP", "2026-11-27", 3),
    ]);
  });

  test("only a rise past what was sent; a fall or the same level is not sent again", () => {
    const sent = new Map([
      [sentKey({ regencyCode: "11.08", hazard: "BNJ", date: "2026-11-26" }), 2],
      [sentKey({ regencyCode: "11.08", hazard: "BNJ", date: "2026-11-27" }), 3],
      [sentKey({ regencyCode: "11.08", hazard: "ASP", date: "2026-11-27" }), 2],
    ]);
    expect(risenWarnings(FILE, sent, NOW)).toEqual([rise("LSR", "2026-11-27", 1), rise("ASP", "2026-11-27", 3)]);
  });

  test("an outlook older than 36 hours sends nothing", () => {
    const made = Date.parse(FILE.dibuat);
    // At 18.00 WIB the next day, the first day has passed.
    expect(risenWarnings(FILE, new Map(), made + 36 * HOUR_MS)).toHaveLength(3);
    expect(risenWarnings(FILE, new Map(), made + 36 * HOUR_MS + 1)).toEqual([]);
  });

  test("Waspada waits out the night, 22.00 to 05.00 WIB; Siaga and Awas never wait", () => {
    const wib = (hour: number, minute = 0) => Date.UTC(2026, 10, 26, hour - 7, minute);
    expect([21, 22, 23, 4, 5].map((hour) => heldAtNight(1, wib(hour)))).toEqual([false, true, true, true, false]);
    expect(heldAtNight(1, wib(4, 59))).toBe(true);
    expect(heldAtNight(2, wib(23))).toBe(false);
    expect(heldAtNight(3, wib(23))).toBe(false);
    expect(risenWarnings(FILE, new Map(), wib(23))).toEqual([
      rise("BNJ", "2026-11-26", 2),
      rise("ASP", "2026-11-27", 3),
    ]);
  });

  test("a phone hears of one rise: of its hazards, at or past its level, the highest, then the soonest", () => {
    const rises = [
      rise("BNJ", "2026-11-27", 2),
      rise("BNJ", "2026-11-26", 2),
      rise("ASP", "2026-11-27", 3),
      rise("LSR", "2026-11-26", 1),
    ];
    expect(riseFor(rises, ALL_HAZARDS, 1)).toEqual(rise("ASP", "2026-11-27", 3));
    expect(riseFor(rises, 1, 1)).toEqual(rise("BNJ", "2026-11-26", 2));
    expect(riseFor(rises, 2, 1)).toEqual(rise("LSR", "2026-11-26", 1));
    expect(riseFor(rises, 2, 2)).toBeNull();
    expect(riseFor(rises, 8, 1)).toBeNull();
    expect(riseFor([], ALL_HAZARDS, 1)).toBeNull();
  });
});
