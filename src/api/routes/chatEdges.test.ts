import { describe, expect, test, vi } from "vitest";
import type { Database } from "../../platform/database";
import type { ModelPort } from "../../ports/model";
import { losesOnce, manualClock, query, racing, testBindings } from "../../testing/api";
import { chat, GATEWAY_SECRETS, known, reach, sent, VILLAGE } from "../../testing/gateway";
import { cameraJpeg } from "../../testing/photoBase";
import { api } from "../app";

vi.setConfig({ testTimeout: 60_000 });

// One chat whose database, model and clock a test takes over in the middle.
function world(model?: ModelPort) {
  const clock = manualClock("2026-11-25T03:00:00.000Z");
  const recorded = { MODEL_MODE: "recorded", MODEL_BASE_URL: "http://localhost:8790", MODEL_NAME: "recorded" };
  const { bindings } = testBindings(
    { GATEWAY_SECRETS, ...(model ? recorded : {}) },
    { clock, ...(model ? { model } : {}) },
  );
  let db = bindings.db;
  let step = 20_000;
  const one = chat(
    (request) => {
      clock.advance(step);
      return api.app.fetch(request, { ...bindings, db });
    },
    { now: clock.now },
  );
  return {
    clock,
    one,
    use: (next: Database) => {
      db = next;
    },
    hurry: () => {
      step = 1;
    },
  };
}

const latestDraft = async (number: string) =>
  (
    await query<{ id: string }>`select d.id from report_draft d join reporter r on r.id = d.reporter_id
      where r.number = ${number} order by d.rowid desc limit 1`
  )[0]?.id as string;

describe("two messages at once", () => {
  test("the one that came second is told to send again, with the question as it is now", async () => {
    const { one, use } = world();
    await known(one);
    use(
      losesOnce("update report_draft set state", async () => {
        await query`update report_draft set revision = revision + 1 where id = ${await latestDraft(one.number)}`;
      }),
    );
    expect((await one.send("tidak tahu")).text).toMatch(/^Pesan sebelumnya masih diproses[\s\S]*\*RT dan RW\*/);
    expect((await one.send("tidak tahu")).text).toMatch(/^\*Jenis bencana\*/);
  });

  test("a send that lost is told the same", async () => {
    const { one, use } = world();
    await known(one);
    await reach(one, /^\*Ringkasan laporan/m);
    use(
      racing(async (texts) => {
        if (!texts.some((text) => text.includes("insert into ticket_day_counter"))) return "pass";
        await query`update report_draft set revision = revision + 1 where id = ${await latestDraft(one.number)}`;
        return "lose";
      }),
    );
    expect((await one.send("1")).text).toMatch(/^Pesan sebelumnya masih diproses[\s\S]*Ringkasan laporan/);
  });

  test("photos sent together all land", async () => {
    const { one, use } = world();
    await known(one);
    await reach(one, /^\*Foto kejadian/m);
    use(
      losesOnce("insert into draft_photo", async () => {
        await query`update report_draft set revision = revision + 1 where id = ${await latestDraft(one.number)}`;
      }),
    );
    expect((await one.photo(cameraJpeg())).text).toMatch(/^\*Foto 1 dari 10 diterima\*/);
  });

  test("photos that keep losing are told to be sent again", async () => {
    const { one, use } = world();
    await known(one);
    await reach(one, /^\*Foto kejadian/m);
    use(
      racing(async (texts) => {
        if (!texts.some((text) => text.includes("insert into draft_photo"))) return "pass";
        await query`update report_draft set revision = revision + 1 where id = ${await latestDraft(one.number)}`;
        return "lose";
      }),
    );
    expect((await one.photo(cameraJpeg())).text).toMatch(/^Pesan sebelumnya masih diproses/);
  });

  test("a report that ends between the reads is gone", async () => {
    const { one, use } = world();
    await known(one);
    let reads = 0;
    use(
      racing(
        async () => "pass",
        async (text) => {
          if (!text.includes("from report_draft d")) return;
          reads += 1;
          if (reads === 2)
            await query`update report_draft set state = 'expired', fields = null, back_stack = null, ended_at = 'x'
              where id = ${await latestDraft(one.number)}`;
        },
      ),
    );
    expect((await one.send("tidak tahu")).text).toMatch(
      /^Laporan yang belum selesai sudah 24 jam[\s\S]*Ketik salah satu/,
    );
  });

  test("a report opened between the reads is finished before news", async () => {
    const { one, use } = world();
    const ticket = await sent(one);
    let reads = 0;
    use(
      racing(
        async () => "pass",
        async (text) => {
          if (!text.includes("follow_up_of is not null")) return;
          reads += 1;
          if (reads === 2)
            await query`insert into report_draft (id, reporter_id, profile_id, owner_slot, state, fields, back_stack,
                asked, created_at, last_acted_at)
              select ${crypto.randomUUID()}, p.reporter_id, p.id, 'session', 'place',
                '{"states":{},"chronology":null,"guesses":[],"overlay":null,"danger":null}', '[]', '{}',
                '2026-11-25T04:00:00.000Z', '2026-11-25T04:00:00.000Z'
              from reporter_profile p join reporter r on r.id = p.reporter_id where r.number = ${one.number}`;
        },
      ),
    );
    expect((await one.send(`kabar ${ticket}`)).text).toMatch(/^Selesaikan dulu laporan ini[\s\S]*\*Lokasi kejadian\*/);
  });
});

describe("the last of what may be said", () => {
  test("news started on the 20th message of a minute waits", async () => {
    const { clock, one, hurry } = world();
    const ticket = await sent(one);
    clock.set(Math.ceil(clock.now() / 60_000) * 60_000);
    hurry();
    for (let count = 0; count < 19; count += 1) await one.send("halo");
    expect((await one.send(`kabar ${ticket}`)).text).toMatch(/^Batas pesan untuk nomor ini tercapai/);
  });

  test("a story is met with a word of sympathy before the next question", async () => {
    const reply = {
      fields: [],
      hazardGuesses: [],
      lifeAtRisk: true,
      reply: "sympathy",
      topic: "disaster",
    };
    const { one } = world({ extract: async () => reply });
    await known(one);
    expect((await one.send("rumah kami hanyut")).text).toMatch(
      /^Bila ada nyawa terancam[\s\S]*Kami ikut prihatin[\s\S]*\*RT dan RW\*/,
    );
  });

  test("where no BPBD number is known, BNPB's own is given; an officer is named as one", async () => {
    const { one } = world();
    for (const text of ["lapor", "1", "2", "Uji Dua", "Kabupaten Uji", "Staf", "sukamaju bengkalis", "1"])
      await one.send(text);
    const summary = await reach(one, /^\*Ringkasan laporan/m);
    expect(summary).toContain("Pelapor: Uji Dua (Petugas BPBD)");
    expect((await one.send("1")).text).toContain("Call Center BNPB 117");
  });

  test("a known number is told what it can write, and news of an emergency begins with nothing known", async () => {
    const { one } = world();
    for (const text of ["darurat", "1", "1", "Uji Satu"]) await one.send(text);
    await one.share(VILLAGE.lat, VILLAGE.lon);
    for (const text of ["1", "1", "2", "1", "1"]) await one.send(text);
    expect((await one.send("bantuan")).text).toMatch(/^\*Pantau Bencana BNPB\*\nKetik salah satu/);
    await one.send("kabar");
    expect((await one.send("kabar")).text).toContain("Belum ada yang berubah");
    expect((await one.send("dua orang meninggal")).text).toContain("• Meninggal: belum didata menjadi 2 orang");
  });
});
