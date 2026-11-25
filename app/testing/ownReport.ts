import type { Card } from "../../src/contract/card";
import type { OwnReportDetail } from "../../src/contract/ownReport";
import { SAMPLE_DRAFTS } from "../../src/testing/samples";

// Fixtures of the reporter's own report page: a synthetic report corrected once by staff.

const { tracking, trackingToken } = SAMPLE_DRAFTS.sent.card as Extract<Card, { kind: "sent" }>;

export const OWN_REPORT: OwnReportDetail = {
  tracking,
  trackingToken,
  versions: [
    {
      version: 2,
      at: { utc: "2026-11-23T05:00:00.000Z", zone: "WIB" },
      madeBy: "officer",
      changes: [
        {
          fieldId: "dead",
          from: { fieldId: "dead", state: "notYetKnown", value: null, origin: null },
          to: { fieldId: "dead", state: "value", value: { kind: "count", count: 2 }, origin: "officer" },
        },
        {
          fieldId: "missing",
          from: null,
          to: { fieldId: "missing", state: "none", value: null, origin: "officer" },
        },
      ],
    },
    { version: 1, at: { utc: "2026-11-23T02:00:00.000Z", zone: "WIB" }, madeBy: "reporter", changes: [] },
  ],
};
