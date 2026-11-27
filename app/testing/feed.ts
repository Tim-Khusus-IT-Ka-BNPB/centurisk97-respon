import type { FeedEntry, Watch } from "../../src/contract/publicFeed";

// A feed entry as the public feed sends it: a closed flood in a cluster of three, two photos marked public.
export const FEED_ENTRY: FeedEntry = {
  id: "0123456789abcdef",
  hazardType: "flood",
  hazardSubtype: "flashFlood",
  status: "closed",
  place: { villageName: "Uji Satu", districtName: "Baktiya", regencyName: "Aceh Utara", provinceName: "Aceh" },
  centre: { lat: 5.1, lon: 97.2 },
  eventTime: { kind: "dateTime", localDate: "2026-11-24", localTime: "08:30", zone: "WIB" },
  sentAt: { utc: "2026-11-24T02:00:00.000Z", zone: "WIB" },
  impact: { dead: 2, missing: null, injured: 0, displaced: null, houses: null },
  reporters: 3,
  proofs: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
};

// A quake still being handled, of one reporter, with no subtype, event time or village outline.
export const FEED_ALONE: FeedEntry = {
  ...FEED_ENTRY,
  id: "fedcba9876543210",
  hazardType: "earthquake",
  hazardSubtype: null,
  status: "in_handling",
  centre: null,
  eventTime: null,
  impact: { dead: null, missing: null, injured: null, displaced: null, houses: null },
  reporters: null,
  proofs: [],
};

// What is on watch: one regency at Siaga, and one volcano at Awas with its radius.
export const WATCH: Watch = {
  forecast: {
    madeAt: "2026-11-26T06:00:00+07:00",
    regencies: [
      {
        regencyCode: "11.08",
        regencyName: "Kab. Aceh Utara",
        provinceName: "Aceh",
        level: 2,
        threats: ["Banjir", "Longsor"],
      },
    ],
  },
  volcanoes: {
    source: "MAGMA Indonesia",
    madeAt: "2026-11-10T15:47:44+07:00",
    counts: [42, 24, 2, 1],
    raised: [
      { name: "Uji", province: "Jawa Timur", level: 4, radiusKm: 7, report: "https://magma.esdm.go.id/v1/x" },
      { name: "Dua", province: "Bali", level: 3, radiusKm: null, report: null },
    ],
  },
};
