import { describe, expect, test } from "vitest";
import { draftBodySchema } from "../../contract/draft";
import { PRIVACY } from "../../domain/privacy";
import { locatePlace } from "../../services/places";
import { browser, failingDatabase, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { turn } from "../../testing/walk";
import { api } from "../app";

const clock = manualClock("2026-11-23T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) => api.app.fetch(request, bindings);

// A point inside the seed outline of Desa Cot Seumiyong, Kec. Kuta Makmur, Aceh Utara.
const INSIDE = { lat: "5.14705", lon: "97.0482" };
const VILLAGE = "11.08.03.2031";

async function start(fetcher = fetchApi) {
  const phone = browser(fetcher);
  const answer = await phone.call("POST", "/consent", {
    role: "citizen",
    name: "Uji Satu",
    number: freshNumber().typed,
    privacyVersion: PRIVACY.version,
    agree: true,
  });
  return { phone, draft: answer.draft };
}

const locate = (values: Record<string, string>) => ({ kind: "locate", values });

describe("place from GPS", () => {
  test("a point inside a village reads as that village with its coordinates and accuracy; Benar goes to RT and RW", async () => {
    const { phone, draft } = await start();
    const read = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, locate({ ...INSIDE, accuracy: "12" })),
    );
    expect(read.status).toBe(200);
    expect(draftBodySchema.parse(read.draft).state).toBe("place_confirm");
    expect(read.draft.card).toMatchObject({
      kind: "placeConfirm",
      titleKey: "card.placeConfirm.title",
      village: {
        code: VILLAGE,
        villageName: "Cot Seumiyong",
        districtName: "Kuta Makmur",
        regencyName: "Aceh Utara",
        provinceName: "Aceh",
      },
      point: { lat: 5.14705, lon: 97.0482, accuracyM: 12 },
      precision: "gpsPoint",
      nearby: null,
    });
    const card = read.draft.card as { options: { id: string }[] };
    expect(card.options.map((option) => option.id)).toEqual(["confirm", "other"]);
    const confirmed = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(read.draft, { optionIds: ["confirm"] }),
    );
    expect(confirmed.draft.card.kind).toBe("neighbourhood");
    expect(confirmed.draft.transcript.filter((line) => line.speaker === "reporter").at(-1)).toMatchObject({
      textMasked: "Cot Seumiyong",
    });
    const [stored] = await query<{ village_code: string; fields: { states: { place: { value: unknown } } } }>`
      select village_code, fields from report_draft where id = ${draft.draftId}`;
    expect(stored?.village_code).toBe(VILLAGE);
    expect(stored?.fields.states.place.value).toMatchObject({
      villageCode: VILLAGE,
      precision: "gpsPoint",
      point: { lat: 5.14705, lon: 97.0482, accuracyM: 12 },
    });
  });

  test("Bukan lists exactly 5 nearby villages with km; picking the second makes it the report's village", async () => {
    const { phone, draft } = await start();
    const read = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, locate({ ...INSIDE, accuracy: "1500" })),
    );
    expect(read.draft.card).toMatchObject({ precision: "estimate" });
    const other = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(read.draft, { optionIds: ["other"] }),
    );
    const card = other.draft.card as {
      kind: string;
      titleKey: string;
      nearby: { code: string; km: number }[];
      options: unknown[];
    };
    expect(card).toMatchObject({ kind: "placeConfirm", titleKey: "card.placeConfirm.nearbyTitle", options: [] });
    expect(card.nearby).toHaveLength(5);
    expect(card.nearby.map((one) => one.code)).not.toContain(VILLAGE);
    const kms = card.nearby.map((one) => one.km);
    expect(kms).toEqual([...kms].sort((a, b) => a - b));
    for (const km of kms) expect(Number.isInteger(km * 10)).toBe(true);
    const second = card.nearby[1] as { code: string };
    // "Benar" is no longer on screen, and a village outside the list is not one of the choices:
    // both answer a card the reporter does not have.
    expect(
      (await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(other.draft, { optionIds: ["confirm"] })))
        .status,
    ).toBe(409);
    expect(
      (await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(other.draft, { villageCode: VILLAGE }))).status,
    ).toBe(409);
    const picked = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(other.draft, { villageCode: second.code }),
    );
    expect(picked.draft.card.kind).toBe("neighbourhood");
    const [stored] = await query<{
      village_code: string;
    }>`select village_code from report_draft where id = ${draft.draftId}`;
    expect(stored?.village_code).toBe(second.code);
  });

  test("a point outside Indonesia is refused and nothing is stored; kembali from a reading returns to search", async () => {
    const { phone, draft } = await start();
    const outside = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, locate({ lat: "40", lon: "-3", accuracy: "10" })),
    );
    expect(outside.status).toBe(200);
    expect(outside.draft.card.kind).toBe("placeSearch");
    expect(outside.draft.notices.map((notice) => notice.copyKey)).toContain("refusal.place.outside");
    const [stored] = await query<{ village_code: string | null; fields: { states: object } }>`
      select village_code, fields from report_draft where id = ${draft.draftId}`;
    expect(stored).toMatchObject({ village_code: null, fields: { states: {} } });
    const read = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(outside.draft, locate({ ...INSIDE, accuracy: "5" })),
    );
    const back = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(read.draft, { kind: "back" }));
    expect(back.draft.card.kind).toBe("placeSearch");
  });

  test("a point in Indonesia far from every village is told so; a broken reading names the field", async () => {
    const { phone, draft } = await start();
    const sea = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, locate({ lat: "-5", lon: "130", accuracy: "10" })),
    );
    expect(sea.draft.notices.map((notice) => notice.copyKey)).toContain("refusal.place.notFound");
    for (const values of [
      { ...INSIDE },
      { ...INSIDE, accuracy: "-1" },
      { ...INSIDE, accuracy: "x" },
      { lat: "", lon: "97", accuracy: "1" },
    ]) {
      const broken = await phone.call("POST", `/drafts/${draft.draftId}/turns`, turn(sea.draft, locate(values)));
      expect(broken.status).toBe(422);
      expect(broken.error.fields).toEqual([
        { fieldId: "location", copyKey: "fieldError.location.invalid", params: {} },
      ]);
    }
  });

  test("a reading is refused past the place step, and says so when place data cannot be read", async () => {
    const { phone, draft } = await start();
    const read = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(draft, locate({ ...INSIDE, accuracy: "12" })),
    );
    // Read again from the nearby list ("Bagikan lokasi ulang").
    const again = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(read.draft, locate({ ...INSIDE, accuracy: "20" })),
    );
    expect(again.draft.card).toMatchObject({ kind: "placeConfirm", point: { accuracyM: 20 } });
    const confirmed = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(again.draft, { optionIds: ["confirm"] }),
    );
    const late = await phone.call(
      "POST",
      `/drafts/${draft.draftId}/turns`,
      turn(confirmed.draft, locate({ ...INSIDE, accuracy: "12" })),
    );
    expect(late.status).toBe(409);

    const { bindings: faulty } = testBindings({ FAULT_PLACE: "on" }, { clock });
    const down = await start((request) => api.app.fetch(request, faulty));
    const refused = await down.phone.call(
      "POST",
      `/drafts/${down.draft.draftId}/turns`,
      turn(down.draft, locate({ ...INSIDE, accuracy: "12" })),
    );
    expect(refused.draft.notices.map((notice) => notice.copyKey)).toContain("refusal.place.unavailable");
  });
});

describe("place from GPS when place data cannot be read", () => {
  test("no active snapshot, or a database that fails, says so and logs only the SQLite code", async () => {
    const { phone, draft } = await start();
    await query`update place_snapshot set active = false where active`;
    try {
      const none = await phone.call(
        "POST",
        `/drafts/${draft.draftId}/turns`,
        turn(draft, locate({ ...INSIDE, accuracy: "12" })),
      );
      expect(none.draft.notices.map((notice) => notice.copyKey)).toContain("refusal.place.unavailable");
    } finally {
      await query`update place_snapshot set active = true where id = (select max(id) from place_snapshot)`;
    }
    for (const [message, code] of [
      ["no such table", "42P01"],
      ["network gone", undefined],
    ] as const) {
      const { bindings: broken, lines } = testBindings({}, { clock });
      const failing = { ...broken, db: failingDatabase(message, code) };
      const result = await locatePlace(failing, { lat: 5.14705, lon: 97.0482, accuracyM: 12 });
      expect(result).toEqual({ kind: "unavailable" });
      expect(lines.at(-1)).toEqual(expect.objectContaining({ event: "place.failed", errorCode: "place.unavailable" }));
      expect(JSON.stringify(lines.at(-1))).not.toContain("no such table");
    }
  });
});
