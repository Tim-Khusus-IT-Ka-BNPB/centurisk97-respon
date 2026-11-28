import { describe, expect, test } from "vitest";
import type { ClusterRow, ShownRow } from "../adapters/postgres/publicFeed";
import { clusterInput } from "./clusters";
import { entryOf } from "./publicFeed";

const SENT = "2026-11-24T03:00:00.000Z";
const place = (point?: object) => ({
  state: "value",
  value: {
    villageCode: "11.08.01.2001",
    precision: point ? "gpsPoint" : "villageLevel",
    ...(point ? { point } : {}),
    snapshotId: 1,
    villageName: "Uji",
    districtName: "Baktiya",
    regencyName: "Aceh Utara",
    provinceName: "Aceh",
  },
});
const clusterRow = (fields: object): ClusterRow => ({
  ticket_number: "LA-241126-01",
  hazard_type: "flood",
  village_code: "11.08.01.2001",
  regency_code: "11.08",
  number_key: "k",
  status: "in_handling",
  sent_at: SENT,
  fields: fields,
  placed_photo: true,
});
const shownRow = (fields: object, centre: [number | null, number | null] = [5.123456, 97.987654]): ShownRow => ({
  report_id: "r",
  ticket_number: "LA-241126-01",
  hazard_type: "flood",
  village_code: "11.08.01.2001",
  status: "closed",
  sent_at: SENT,
  fields: fields,
  centre_lat: centre[0],
  centre_lon: centre[1],
});

describe("a report read for the clusters", () => {
  test("a GPS point and an event time with its hour are used; else none and the send time", () => {
    const timed = {
      state: "value",
      value: { kind: "dateTime", localDate: "2026-11-24", localTime: "08:00", zone: "WIB" },
    };
    expect(
      clusterInput(clusterRow({ place: place({ lat: 5.1, lon: 97.1, accuracyM: 12 }), eventTime: timed })),
    ).toMatchObject({
      point: { lat: 5.1, lon: 97.1 },
      atMs: Date.UTC(2026, 10, 24, 1),
      placedPhoto: true,
    });
    const dateOnly = { state: "value", value: { kind: "dateOnly", localDate: "2026-11-24", zone: "WIB" } };
    expect(clusterInput({ ...clusterRow({ place: place(), eventTime: dateOnly }), placed_photo: false })).toMatchObject(
      {
        point: null,
        atMs: Date.parse(SENT),
        placedPhoto: false,
      },
    );
    expect(clusterInput(clusterRow({ place: place(), eventTime: { state: "notYetKnown" } })).atMs).toBe(
      Date.parse(SENT),
    );
  });
});

describe("a feed entry", () => {
  test("a subtype not known is none, and the village centre is rounded to four places", () => {
    const entry = entryOf(
      shownRow({ place: place(), hazardSubtype: { state: "value", value: "unknown" } }),
      "id",
      null,
      [],
    );
    expect(entry).toMatchObject({ hazardSubtype: null, centre: { lat: 5.1235, lon: 97.9877 }, eventTime: null });
    expect(
      entryOf(shownRow({ place: place(), hazardSubtype: { state: "value", value: "flashFlood" } }), "id", 2, [])
        .hazardSubtype,
    ).toBe("flashFlood");
  });

  test("no centre when the village has no outline, and at most four photos", () => {
    const proofs = ["a", "b", "c", "d", "e"];
    expect(entryOf(shownRow({ place: place() }, [null, null]), "id", null, proofs)).toMatchObject({
      centre: null,
      proofs: ["a", "b", "c", "d"],
    });
    expect(entryOf(shownRow({ place: place() }, [5, null]), "id", null, []).centre).toBeNull();
  });
});
