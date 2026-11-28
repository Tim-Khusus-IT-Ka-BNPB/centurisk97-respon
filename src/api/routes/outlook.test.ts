import { describe, expect, test } from "vitest";
import { outlookSchema } from "../../contract/outlook";
import { type Database, run, sql } from "../../platform/database";
import { browser, failingDatabase, query, testBindings, testDatabase } from "../../testing/api";
import { api } from "../app";
import type { ApiBindings } from "../context";

const { bindings } = testBindings();
let db: Database = testDatabase();
const fetchApi = (request: Request) => api.app.fetch(request, { ...bindings, db } satisfies ApiBindings);
const open = (query: string) => browser(fetchApi).call("GET", `/outlook${query}`);

describe("a regency's outlook", () => {
  test("three days with their levels, the advice and the regency's BPBD", async () => {
    const read = await open("?regency=11.08");
    expect(read.status).toBe(200);
    const outlook = outlookSchema.parse(read.json);
    expect(outlook).toMatchObject({
      regencyName: "Kab. Aceh Utara",
      provinceName: "Aceh",
      madeAt: "2026-11-26T06:00:00+07:00",
      advice: [{ date: "2026-11-26", text: "Siapkan tas siaga dan pantau ketinggian air sungai" }],
      contact: { level: "regency", name: "Kab. Aceh Utara", phone: "0800-1108-0001" },
    });
    expect(outlook.days[0]).toEqual({
      date: "2026-11-26",
      rainMm: 62,
      rainLevel: 2,
      threats: [
        { code: "BNJ", label: "Banjir", level: 2 },
        { code: "LSR", label: "Longsor", level: 1 },
      ],
    });
  });

  test("with no BPBD of its own, the national line", async () => {
    const read = await open("?regency=32.01");
    expect(read.status).toBe(200);
    expect(outlookSchema.parse(read.json).contact).toEqual({ level: "national" });
  });

  test("a regency the file has not: 404; not a regency's code: 400", async () => {
    const missing = await open("?regency=99.99");
    expect(missing.status).toBe(404);
    expect(missing.json).toMatchObject({ error: { code: "outlook.regencyNotFound" } });
    for (const bad of ["", "?regency=1108", "?regency=11.08&x=1"]) expect((await open(bad)).status).toBe(400);
  });

  test("no file, a file that breaks its contract, or no database: 503, never a calm answer", async () => {
    const [kept] = await query<Record<string, string>>`select * from reference_file where name = 'forecast'`;
    const put = (body: string) =>
      run(
        testDatabase(),
        sql`insert into reference_file (name, data_date, source, body, checksum, imported_at)
          values ('forecast', ${kept?.data_date}, ${kept?.source}, ${body}, ${kept?.checksum}, ${kept?.imported_at})
          on conflict (name) do update set body = excluded.body`,
      );
    try {
      await put(JSON.stringify({ dibuat: "kemarin" }));
      expect((await open("?regency=11.08")).status).toBe(503);
      await run(testDatabase(), sql`delete from reference_file where name = 'forecast'`);
      expect((await open("?regency=11.08")).status).toBe(503);
    } finally {
      await put(kept?.body as string);
    }
    db = failingDatabase("no such table", "42P01");
    try {
      expect((await open("?regency=11.08")).status).toBe(503);
    } finally {
      db = testDatabase();
    }
  });
});
