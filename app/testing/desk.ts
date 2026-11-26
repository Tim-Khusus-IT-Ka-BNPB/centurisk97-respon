import { waitFor } from "@testing-library/react";
import { expect } from "vitest";
import type { DeskQueue, DeskReport, DeskSummary } from "../../src/contract/desk";
import { renderPage as stub } from "./render";

// Fixtures of the desk screens' tests: synthetic reports and counts, as the routes answer them.

// The router stub draws once its loader settles.
export async function renderDesk(...args: Parameters<typeof stub>) {
  const result = stub(...args);
  await waitFor(() => expect(document.body.textContent).not.toBe(""));
  return result;
}

export const SENT = { utc: "2026-11-24T02:30:00.000Z", zone: "WIB" } as const;
export const FILTERS = {
  view: "list" as const,
  status: "",
  hazardType: "",
  period: "all",
  ticket: "",
  has: "",
  page: 1,
};

export const ITEM: DeskQueue["items"][number] = {
  ticketNumber: "LA-241126-01",
  status: "new",
  hazardType: "flood",
  hazardSubtype: "unknown",
  place: { villageName: "Sukamaju", districtName: "Contoh", regencyName: "Aceh Utara" },
  eventTime: { kind: "dateOnly", localDate: "2026-11-24", zone: "WIB" },
  sentAt: SENT,
  completePercent: 62,
  photoCount: 2,
  reporter: { name: "Uji Satu", role: "citizen" },
  door: "web",
  officerConfirmed: false,
  numberUnverified: true,
  emergency: null,
  taker: null,
  news: false,
  impact: { dead: 2, missing: null, injured: 0, displaced: null, houses: { count: 3, partial: true } },
  cluster: null,
};

export const queue = (overrides: Partial<DeskQueue> = {}): DeskQueue => ({
  account: { label: "Pusdalops BNPB, Petugas Uji" },
  items: [
    ITEM,
    {
      ...ITEM,
      ticketNumber: "LA-241126-02",
      status: "closed",
      hazardSubtype: "unknown",
      eventTime: { kind: "olderThan30Days" },
      door: "web",
      numberUnverified: false,
      reporter: { name: "Uji Dua", role: "claimedOfficer" },
    },
  ],
  total: 2,
  page: 1,
  pageCount: 1,
  ...overrides,
});

export const list = (queue: DeskQueue) => ({ view: "list" as const, queue });

export const REPORT: DeskReport = {
  event: null,
  videos: [],
  ...ITEM,
  status: "seen",
  account: { label: "Pusdalops BNPB, Petugas Uji" },
  reporter: {
    role: "claimedOfficer",
    identity: {
      name: "Uji Satu",
      number: "+6280000000001",
      officerRegency: "Kabupaten Uji",
      officerPosition: "Staf",
    },
  },
  point: {
    ticketNumber: "LA-241126-01",
    status: "seen",
    hazardType: "flood",
    villageName: "Sukamaju",
    precision: "gpsPoint",
    emergency: false,
    lat: 5.1,
    lon: 97.1,
  },
  groups: [
    {
      groupId: "event",
      rows: [
        {
          fieldId: "hazardType",
          state: "value",
          value: { kind: "hazardType", hazardType: "flood" },
          origin: "tappedOption",
          quote: null,
        },
      ],
    },
    {
      groupId: "victims",
      rows: [
        {
          fieldId: "dead",
          state: "value",
          value: { kind: "count", count: 2 },
          origin: "quote",
          quote: "dua orang meninggal",
        },
        { fieldId: "missing", state: "confirmedUnknown", value: null, origin: "boxEntry", quote: null },
        { fieldId: "injured", state: "notYetKnown", value: null, origin: null, quote: null },
      ],
    },
  ],
  history: [
    { status: "new", at: SENT, actor: null, note: null, forwardedTo: null, event: null, detail: null },
    {
      status: "seen",
      at: { ...SENT, utc: "2026-11-24T02:40:00.000Z" },
      actor: "Pusdalops BNPB, Petugas Uji",
      note: "Dicek",
      forwardedTo: null,
      event: null,
      detail: null,
    },
  ],
  reporterWords: [{ text: "banjir, dua orang meninggal", at: SENT }],
  photos: [],
  nextStatuses: [
    { status: "under_review", note: "optional" },
    { status: "invalid", note: "reason" },
  ],
  revision: 1,
  mayTake: false,
  revisable: [
    { fieldId: "dead", unit: "people", max: 100_000, count: 2 },
    { fieldId: "injured", unit: "people", max: 1_000_000, count: null },
  ],
  offeredActions: [
    { code: "evakuasi", label: "Evakuasi warga" },
    { code: "logistik", label: "Distribusi logistik" },
  ],
  actions: [],
  proofs: [],
  replies: [],
  chatNews: null,
  newsStopped: false,
  versions: [
    {
      version: 2,
      at: { ...SENT, utc: "2026-11-24T03:00:00.000Z" },
      madeBy: "officer",
      changes: [
        {
          fieldId: "dead",
          from: { fieldId: "dead", state: "value", value: { kind: "count", count: 3 }, origin: "boxEntry" },
          to: { fieldId: "dead", state: "value", value: { kind: "count", count: 2 }, origin: "officer" },
        },
      ],
    },
    { version: 1, at: SENT, madeBy: "reporter", changes: [] },
  ],
};

export const SUMMARY: DeskSummary = {
  account: { label: "Pusdalops BNPB, Petugas Uji" },
  total: 9,
  byStatus: { new: 4, seen: 1, under_review: 2, forwarded: 0, in_handling: 0, closed: 2, invalid: 0 },
  byHazard: { flood: 7, landslide: 2 },
  byHas: { news: 2, victims: 3, displaced: 1, houses: 5, photos: 0 },
  emergencies: [],
  mayReadResponse: true,
  mayManagePilot: true,
};
