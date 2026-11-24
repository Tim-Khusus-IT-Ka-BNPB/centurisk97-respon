import { describe, expect, test } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { api } from "../../api/app";
import { browser, freshNumber, manualClock, query, testBindings } from "../../testing/api";
import { seededIdentity } from "./seeded";

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const DAY = 24 * 60 * 60 * 1000;

describe("device last seen", () => {
  test("a device is seen to the day: requests within a day write nothing, the first a day later moves it", async () => {
    const phone = browser((request: Request) => api.app.fetch(request, bindings));
    const started = await phone.call("POST", "/consent", {
      role: "citizen",
      name: "Uji Satu",
      number: freshNumber().typed,
      privacyVersion: 1,
      agree: true,
    });
    const seen = async () => {
      const [row] = await query<{ last_seen_at: string }>`
        select d.last_seen_at from report_draft r join reporter_profile p on p.id = r.profile_id
        join device d on d.id = p.device_id where r.id = ${started.draft.draftId}`;
      return row?.last_seen_at;
    };
    expect(await seen()).toBe("2026-11-24T03:00:00.000Z");
    clock.advance(DAY - 1);
    expect((await phone.call("GET", "/me")).status).toBe(200);
    expect(await seen()).toBe("2026-11-24T03:00:00.000Z");
    clock.advance(1);
    expect((await phone.call("GET", "/me")).status).toBe(200);
    expect(await seen()).toBe("2026-11-25T03:00:00.000Z");
  });

  test("an unknown device key is anonymous", async () => {
    const phone = browser((request: Request) => api.app.fetch(request, bindings));
    phone.cookies.set("device_key", "not-a-key-we-issued");
    const me = await phone.call("GET", "/me");
    expect(me.json).toMatchObject({ knownReporters: [], session: null });
  });
});

describe("seeded staff", () => {
  const resolve = (index: number) =>
    seededIdentity(bindings.db, clock).resolve(
      new Headers({ cookie: `seeded_session=${(SEEDED_SESSIONS[index] as { token: string }).token}` }),
    );

  test("a staff session names the account, its label and where it may work", async () => {
    expect(await resolve(2)).toEqual({
      kind: "staff",
      staffId: "staff-desk-1",
      role: "deskOfficer",
      label: "Pusdalops BNPB, Petugas Uji",
      scope: { level: "national" },
    });
    expect(await resolve(3)).toMatchObject({ role: "regionalOfficer", scope: { level: "regency", code: "11.08" } });
    expect(await resolve(4)).toMatchObject({ role: "regionalOfficer", scope: { level: "province", code: "12" } });
  });
});
