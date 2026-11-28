import { beforeAll, describe, expect, test, vi } from "vitest";
import { SEEDED_SESSIONS } from "../../../db/synthetic/reporters";
import { browser, freshNumber, manualClock, query, testBindings, testDatabase } from "../../testing/api";
import { sendDraft, startDraft, turn } from "../../testing/walk";
import { api } from "../app";
import type { ApiBindings } from "../context";

vi.setConfig({ testTimeout: 120_000 });

const clock = manualClock("2026-11-24T03:00:00.000Z");
const { bindings } = testBindings({}, { clock });
const fetchApi = (request: Request) =>
  api.app.fetch(request, { ...bindings, db: testDatabase() } satisfies ApiBindings);
const tick = () => clock.advance(4000);

const signedIn = (index: number) => {
  const phone = browser(fetchApi);
  phone.cookies.set("seeded_session", (SEEDED_SESSIONS[index] as { token: string }).token);
  return phone;
};

let village = "";
beforeAll(async () => {
  const [found] = await query<{ code: string }>`
    select v.code from place_village v join place_snapshot s on s.id = v.snapshot_id and s.active
    where v.regency_code = '11.08' order by v.code limit 1`;
  village = found?.code as string;
});

const sentReport = async (text: string) => {
  const phone = browser(fetchApi);
  const started = await startDraft(phone, freshNumber().typed, "Uji Rahasia");
  const told = await phone.call("POST", `/drafts/${started.draftId}/turns`, turn(started, { kind: "freeText", text }));
  return sendDraft(phone, told.draft, village, { tick });
};
const download = async (phone = signedIn(2)) => {
  const answer = await phone.file("/desk/aggregates", {});
  return { ...answer, text: new TextDecoder().decode(answer.bytes) };
};

describe("the weekly counts", () => {
  test("a BNPB officer downloads them as CSV: a hidden cell under 3 numbers, counts from 3, nobody named", async () => {
    const ticket = await sentReport("banjir");
    const few = await download();
    expect(few.status).toBe(200);
    expect(few.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(few.headers.get("content-disposition")).toBe('attachment; filename="lapor-agregat-mingguan-2026-11-24.csv"');
    const [header, ...lines] = few.text.trim().split("\n");
    expect(header).toBe(
      "minggu,kode_provinsi,provinsi,kode_kabupaten_kota,kabupaten_kota,jenis_bencana,laporan,pelapor,laporan_dengan_foto_berlokasi,tidak_dapat_ditindaklanjuti,median_menit_kejadian_sampai_lapor",
    );
    expect(lines).toContain("2026-W48,11,Aceh,11.08,Aceh Utara,Banjir,<3,<3,,,");
    await sentReport("banjir");
    await sentReport("banjir");
    const open = await download();
    expect(open.text).toMatch(/2026-W48,11,Aceh,11\.08,Aceh Utara,Banjir,\d+,\d+,0,0,/);
    for (const hidden of ["Uji Rahasia", ticket, village]) expect(open.text).not.toContain(hidden);
    expect(await query`select staff_label from aggregate_download order by id`).toEqual([
      { staff_label: "Pusdalops BNPB, Petugas Uji" },
      { staff_label: "Pusdalops BNPB, Petugas Uji" },
    ]);
  });

  test("a BPBD account may not, and one signed out is asked to sign in", async () => {
    expect((await download(signedIn(3))).status).toBe(403);
    expect((await download(browser(fetchApi))).status).toBe(401);
  });
});
