import type { OutlookView } from "../../src/contract/outlook";

// A regency's outlook as the API sends it: every level once, a day with no rain figure, one advice.
export const OUTLOOK: OutlookView = {
  regencyName: "Kab. Aceh Utara",
  provinceName: "Aceh",
  madeAt: "2026-11-26T06:00:00+07:00",
  days: [
    {
      date: "2026-11-26",
      rainMm: 62,
      rainLevel: 2,
      threats: [
        { code: "BNJ", label: "Banjir", level: 3 },
        { code: "LSR", label: "Longsor", level: 1 },
      ],
    },
    { date: "2026-11-27", rainMm: 18, rainLevel: 0, threats: [] },
    { date: "2026-11-28", rainMm: null, rainLevel: null, threats: [] },
  ],
  advice: [{ date: "2026-11-26", text: "Siapkan tas siaga" }],
  contact: { level: "regency", name: "Kab. Aceh Utara", phone: "0800-1108-0001" },
};
