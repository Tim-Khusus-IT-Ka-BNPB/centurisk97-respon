import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { type DeskReport, deskReportSchema } from "../../contract/desk";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 90_000 });

const clock = manualClock("2026-11-26T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);

const signedIn = (index: number) => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};
const bnpb = () => signedIn(2);
const bpbd = () => signedIn(3);

const villages: Record<string, string> = {};
beforeAll(async () => {
  for (const [name, where] of [
    ["aceh", "v.regency_code = '11.08'"],
    ["elsewhere", "v.regency_code like '12.%'"],
  ] as const) {
    const [found] = await query<{ code: string }>([
      `select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active = 1 where ${where} order by v.code limit 1`,
    ] as unknown as TemplateStringsArray);
    villages[name] = found?.code as string;
  }
});

const reportIn = async (village: string) => {
  const phone = browser(fetchApi);
  return sendDraft(phone, await startDraft(phone, freshNumber().typed), village, { tick });
};
const officersOn = async (phone: ReturnType<typeof browser>, ticket: string) => {
  const answer = await phone.call("GET", `/desk/reports/${ticket}`);
  expect(answer.status, JSON.stringify(answer.json)).toBe(200);
  return (deskReportSchema.parse(answer.json) as DeskReport).officers;
};

describe("the BPBD officers on a report (PF-09)", () => {
  test("BNPB sees the regency's officers with numbers masked; a BPBD account sees none", async () => {
    const ticket = await reportIn(villages.aceh as string);
    expect(await officersOn(bnpb(), ticket)).toEqual({
      items: [
        {
          profileId: "profile-1108-a",
          name: "Uji Andi",
          position: "Pusdalops",
          agency: "BPBD Kabupaten Uji Satu",
          level: "regency",
          masked: "0800****8001",
        },
        {
          profileId: "profile-1108-b",
          name: "Uji Budi",
          position: "Kedaruratan",
          agency: "BPBD Kabupaten Uji Satu",
          level: "regency",
          masked: "0800****8002",
        },
      ],
      official: null,
    });
    expect(await officersOn(bpbd(), ticket)).toBeNull();
  });

  test("a number is opened one at a time, each time logged, for BNPB alone", async () => {
    const ticket = await reportIn(villages.aceh as string);
    const opened = await bnpb().call("POST", `/desk/reports/${ticket}/officers/profile-1108-b/number`);
    expect(opened.json).toEqual({ profileId: "profile-1108-b", number: "+628001108002" });
    expect(
      await query`select staff_label, profile_id from officer_number_view where ticket_number = ${ticket}`,
    ).toEqual([{ staff_label: "Pusdalops BNPB, Petugas Uji", profile_id: "profile-1108-b" }]);
    const refused = await bpbd().call("POST", `/desk/reports/${ticket}/officers/profile-1108-b/number`);
    expect(refused.error.error.code).toBe("desk.notAllowed");
    for (const path of [
      `/desk/reports/${ticket}/officers/profile-other/number`,
      "/desk/reports/LA-010101-99/officers/profile-1108-b/number",
    ])
      expect((await bnpb().call("POST", path)).status, path).toBe(404);
    expect(await query`select 1 from officer_number_view where ticket_number = ${ticket}`).toHaveLength(1);
  });

  test("with no officer of the regency, the BPBD's own number from the contact file", async () => {
    const ticket = await reportIn(villages.elsewhere as string);
    const officers = await officersOn(bnpb(), ticket);
    expect(officers?.items).toEqual([]);
    expect(officers?.official).toMatchObject({ level: expect.stringMatching(/^(regency|province|national)$/) });
  });
});
