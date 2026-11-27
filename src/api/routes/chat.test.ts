import { describe, expect, test, vi } from "vitest";
import { placeChatPhotos } from "../../adapters/d1/photos";
import { manualClock, query, testBindings } from "../../testing/api";
import { chat, type chat as chatOf, GATEWAY_SECRETS, known, reach, sent, VILLAGE } from "../../testing/gateway";
import { cameraJpeg } from "../../testing/photoBase";
import { api } from "../app";

vi.setConfig({ testTimeout: 60_000 });

// Each message moves the clock 20 seconds on, so a whole report stays under the minute limit.
const START = "2026-11-25T03:00:00.000Z";

function door(overrides: Record<string, string> = {}, start = START) {
  const clock = manualClock(start);
  const { bindings } = testBindings({ GATEWAY_SECRETS, ...overrides }, { clock });
  const open = (number?: string) =>
    chat(
      (request) => {
        clock.advance(20_000);
        return api.app.fetch(request, bindings);
      },
      { now: clock.now },
      number,
    );
  return { clock, bindings, open };
}

type One = ReturnType<typeof chatOf>;

// Reports of earlier tests are near: the offer of one is answered no, and the next question read.
const pastOffer = async (one: One, text: string) =>
  /^\*Kejadian yang sama\?\*/.test(text) ? (await one.send("bukan")).text : text;
const { clock, bindings, open } = door();

const reporters = (number: string) => query`select id from reporter where number = ${number}`;
type Draft = {
  id: string;
  state: string;
  fields: { states: Record<string, { state: string; value?: unknown }> };
  revision: number;
};
const draftOf = async (number: string) =>
  (
    await query<Draft>`
      select d.id, d.state, d.fields, d.revision from report_draft d join reporter r on r.id = d.reporter_id
      where r.number = ${number} order by d.created_at desc, d.rowid desc limit 1`
  )[0] as Draft;
const states = async (one: One) => (await draftOf(one.number)).fields.states;
const version = async (ticket: string, number = 1) =>
  (
    await query<{ fields: Record<string, { state: string; value?: unknown; origin?: string; quote?: string }> }>`
      select v.fields from report_version v join report r on r.id = v.report_id
      where r.ticket_number = ${ticket} and v.version = ${number}`
  )[0]?.fields as Record<string, { state: string; value?: unknown; origin?: string; quote?: string }>;

describe("who is reporting (AC-01)", () => {
  test("an unknown number is asked to agree, and nothing of it is kept before it does", async () => {
    const one = open();
    const { text } = await one.send("banjir di kampung kami");
    expect(text).toMatch(/^\*Pantau Bencana BNPB\*/);
    expect(text).toContain("hubungi 112");
    expect(text).toContain("Pesan Anda tadi belum disimpan");
    expect(text).toContain("1. Setuju\n2. Tidak setuju");
    expect(text).toContain("http://localhost:5173/privacy");
    expect(await reporters(one.number)).toEqual([]);
    const [session] = await query<{ step: string }>`select step from chat_session order by updated_at desc limit 1`;
    expect(JSON.parse(session?.step as string)).toEqual({ kind: "consent", emergency: false });
    const declined = await one.send("2");
    expect(declined.text).toContain("Tidak ada data Anda yang disimpan");
    expect(await reporters(one.number)).toEqual([]);
    expect(await query`select step from chat_session where updated_at = ${new Date(clock.now())}`).toEqual([]);
  });

  test("a citizen agrees, is named, and is asked for the place", async () => {
    const one = open();
    const asked = await one.send("lapor");
    expect(asked.text).not.toContain("belum disimpan");
    expect((await one.send("mungkin")).text).toMatch(/^Jawaban itu belum terbaca/);
    expect((await one.send("1")).text).toContain("1. Warga\n2. Petugas BPBD");
    expect((await one.send("bantuan")).text).toMatch(/^\*Cara menjawab\*[\s\S]*\*Melapor sebagai\*/);
    expect((await one.send("1")).text).toContain("*Nama Anda?*");
    expect((await one.send("Uji 1")).text).toMatch(/^Nama tidak boleh berisi angka[\s\S]*\*Nama Anda\?\*/);
    const { text } = await one.send("Uji Satu");
    expect(text).toMatch(/^Melapor sebagai Uji Satu \(Warga\)/);
    expect(text).toContain("*Lokasi kejadian*");
    expect(await reporters(one.number)).toHaveLength(1);
    const [consent] = await query<{ agreed_at: string; owner_slot: string; device_id: null }>`
      select c.agreed_at, p.owner_slot, p.device_id from reporter_consent c join reporter_profile p on p.id = c.profile_id
      join reporter r on r.id = p.reporter_id where r.number = ${one.number}`;
    expect(consent).toMatchObject({ owner_slot: "session", device_id: null });
    // Four messages before the name came.
    expect(Date.parse(consent?.agreed_at as string)).toBe(clock.now() - 4 * 20_000);
  });

  test("an officer is also asked for BPBD and post", async () => {
    const one = open();
    for (const text of ["lapor", "ya", "petugas bpbd", "Uji Dua"]) await one.send(text);
    expect((await one.send("ab")).text).toMatch(/paling sedikit 3 huruf/);
    expect((await one.send("Kabupaten Uji")).text).toContain("*Jabatan Anda di BPBD?*");
    expect((await one.send("Staf")).text).toMatch(/^Melapor sebagai Uji Dua \(Petugas BPBD\)/);
  });

  test("batal, a location and a photo while being asked", async () => {
    const one = open();
    expect((await one.share(1, 100)).text).toContain("1. Setuju");
    expect((await one.share(1, 100)).text).toMatch(/^Jawaban itu belum terbaca/);
    expect(await one.photo(cameraJpeg())).toMatchObject({ status: 409 });
    expect((await one.send("batal")).text).toMatch(/^\*Pelaporan dibatalkan\*/);
    const photo = await one.photo(cameraJpeg());
    expect([photo.status, photo.text.includes("1. Setuju")]).toEqual([409, true]);
    const other = open();
    expect((await other.send("halo")).text).not.toContain("belum disimpan");
    for (const text of ["status", "ganti nama", "kabar", "dokumen"])
      expect((await other.send(text)).text, text).toContain("1. Setuju");
    expect((await open().send("darurat")).text).toContain("1. Setuju");
    expect(await reporters(one.number)).toEqual([]);
  });
});

describe("a whole report (AC-02)", () => {
  test("the same questions and ticket, and the desk holds what a web report holds", async () => {
    const one = open();
    await known(one);
    const summary = await reach(one, /^\*Ringkasan laporan/m, [
      [/^\*RT dan RW/m, "RT 4 RW 2"],
      [/langkah 3 dari/, "1 2"],
      [/• Meninggal/, "2 0 -"],
      [/^\*Pengungsian/m, "30 8"],
      [/^\*Titik pengungsian/m, "SDN 1 Contoh"],
      [/^\*Kelompok rentan/m, "1, 3"],
    ]);
    for (const line of [
      "Pelapor: Uji Satu (Warga)",
      "Jenis bencana: Banjir",
      "RT dan RW: RT 4 dan RW 2",
      "Meninggal: 2 orang",
      "Hilang: tidak ada",
      "Luka-luka: tidak tahu",
      "Mengungsi: 30 orang",
      "*Kelompok rentan*\nBayi atau balita dan Lansia",
      "Titik pengungsian: SDN 1 Contoh",
      "Tanpa foto",
      "1. Kirim\n2. Ubah\n3. Batal",
    ])
      expect(summary).toContain(line);
    const { text } = await one.send("kirim");
    const ticket = (/\*(LA-251126-\d{2,})\*/.exec(text) as RegExpExecArray)[1] as string;
    expect(text).toContain("Terima kasih, Uji.");
    expect(text).toContain("BPBD Aceh Utara: 0800");
    expect(text).toMatch(/http:\/\/localhost:5173\/track#t=[0-9a-f]{32}/);
    const [report] = await query`
      select door, number_unverified, owner_slot from report where ticket_number = ${ticket}`;
    expect(report).toEqual({ door: "chat", number_unverified: 0, owner_slot: "session" });
    const fields = await version(ticket);
    expect(fields.dead).toEqual({ state: "value", value: 2, origin: "boxEntry" });
    expect(fields.missing).toEqual({ state: "none", origin: "boxEntry" });
    // Asked twice and still empty.
    expect(fields.injured).toMatchObject({ state: "confirmedUnknown" });
    expect(fields.place).toMatchObject({
      value: { precision: "chatLocation", point: { ...VILLAGE, accuracyM: null } },
    });
    expect(fields.eventTime).toMatchObject({ value: { localDate: "2026-11-25", localTime: "07:00", zone: "WIB" } });
  });

  test("a story of a known number starts a report, and is read at once", async () => {
    const later = door();
    const one = later.open();
    await sent(one);
    later.clock.advance(73 * 3_600_000);
    const { text } = await one.send("ada banjir, dua orang meninggal");
    expect(text).toMatch(/^Melapor sebagai Uji Satu \(Warga\)/);
    expect(text).toContain("*Lokasi kejadian*");
    expect((await states(one)).dead).toEqual({
      state: "value",
      value: 2,
      origin: "quote",
      quote: "dua orang meninggal",
    });
    expect((await one.send("lapor")).text).toMatch(/^Anda masih mengisi laporan ini/);
  });

  test("a location from a known number with no report open starts one there", async () => {
    const one = open();
    await sent(one);
    const { text } = await one.share(VILLAGE.lat, VILLAGE.lon);
    expect(text).toMatch(/^Melapor sebagai[\s\S]*\*Lokasi terbaca\*[\s\S]*Lokasi dibagikan lewat WhatsApp/);
    expect((await draftOf(one.number)).state).toBe("place_confirm");
  });
});

describe("the place", () => {
  test("by name: a numbered list, an area opened, and a village picked", async () => {
    const one = open();
    for (const text of ["lapor", "1", "1", "Uji Satu"]) await one.send(text);
    expect((await one.send("su")).text).toMatch(/^Kata pencarian terlalu pendek/);
    expect((await one.send("x".repeat(61))).text).toMatch(/^Kata pencarian terlalu panjang/);
    const listed = (await one.send("sukamaju")).text;
    expect(listed).toMatch(/^\*72 tempat cocok dengan "sukamaju"\*/);
    expect(listed).toContain("1. Kec. Sukamaju, Luwu Utara (lihat desanya)");
    expect(listed).toContain("Baru 10 dari 72.");
    expect((await one.send("11")).text).toBe("Pilihannya 1 sampai 10, jadi belum ada yang dicatat.");
    const area = (await one.send("1")).text;
    expect(area).toMatch(/^\*Desa di Sukamaju\*/);
    const none = (await one.send("tidakadadesaini")).text;
    expect(none).toContain('Tidak ada tempat yang cocok dengan "tidakadadesaini"');
    expect((await one.send("1")).text).toMatch(/Kata pencarian terlalu pendek/);
    await one.send("karo");
    const regency = (await one.send("1")).text;
    expect(regency).toMatch(/^\*Desa di/);
    const within = (await one.send("sukamaju")).text;
    expect(within).toMatch(/Desa\/Kel\. Sukamaju/);
    expect((await one.send("1")).text).toMatch(/^\*RT dan RW\*/);
    expect(await states(one)).toHaveProperty("place");
  });

  test("a command passes by the search, and search that cannot be read says so", async () => {
    const one = open();
    for (const text of ["lapor", "1", "1", "Uji Satu"]) await one.send(text);
    expect((await one.send("kembali")).text).toMatch(/^Belum ada jawaban yang bisa dibatalkan/);
    const broken = door({ FAULT_PLACE: "on" }, new Date(clock.now()).toISOString()).open(one.number);
    expect((await broken.send("sukamaju")).text).toMatch(/^Daftar tempat sedang tidak bisa dibuka/);
    expect((await broken.share(VILLAGE.lat, VILLAGE.lon)).text).toMatch(/^Lokasi dari GPS belum bisa dibaca/);
    expect((await one.share(40, 2)).text).toMatch(/^Lokasi itu di luar Indonesia/);
  });

  test("a shared location is confirmed, or another village near it is picked", async () => {
    const one = open();
    for (const text of ["lapor", "1", "1", "Uji Satu"]) await one.send(text);
    const read = (await one.share(VILLAGE.lat, VILLAGE.lon)).text;
    expect(read).toContain("1. Benar\n2. Bukan, pilih desa/kelurahan lain");
    expect(read).not.toContain("ketelitian");
    expect((await one.send("mungkin di sana")).text).toMatch(/^Jawaban itu belum terbaca/);
    expect((await one.send("5")).text).toMatch(/^Pilihannya 1 sampai 2/);
    const nearby = (await one.send("bukan")).text;
    expect(nearby).toMatch(/1\. Desa\/Kel\. .+ km dari titik Anda/);
    expect((await one.send("99")).text).toMatch(/^Pilihannya 1 sampai \d/);
    // None of them: a name is looked for, and what is no place, or too short for one, keeps the list.
    for (const text of ["tempatnya entah", "di", "x".repeat(200)])
      expect((await one.send(text)).text, text).toMatch(/^Jawaban itu belum terbaca[\s\S]*km dari titik Anda/);
    expect((await one.send("sukamaju karo")).text).toContain("Sukamaju");
    expect((await one.send("1")).text).toMatch(/^\*RT dan RW\*/);
    await one.send("kembali");
    await one.share(VILLAGE.lat, VILLAGE.lon);
    await one.send("bukan");
    expect((await one.send("kembali")).text).toContain("1. Benar");
    await one.send("2");
    expect((await one.send("1")).text).toMatch(/^\*RT dan RW\*/);
    expect((await one.share(VILLAGE.lat, VILLAGE.lon)).text).toMatch(/^Lokasi kejadian sudah tercatat/);
  });
});

describe("answers", () => {
  test("RT and RW, or not known, and what is neither is asked again", async () => {
    const one = open();
    await known(one);
    expect((await one.send("dekat masjid")).text).toMatch(
      /^Pesan itu belum menjawab pertanyaan ini[\s\S]*\*RT dan RW\*/,
    );
    expect((await one.send("RT 4567")).text).toMatch(/RT diisi 1 sampai 3 angka/);
    expect(await pastOffer(one, (await one.send("004/012")).text)).toMatch(/^\*Jenis bencana\*/);
    expect((await states(one)).neighbourhood).toMatchObject({ value: { rt: "004", rw: "012" } });
  });

  test("a number off the list, two where one is asked, and words that say nothing (AC-07)", async () => {
    const one = open();
    await known(one);
    await pastOffer(one, (await one.send("-")).text);
    const before = await draftOf(one.number);
    expect((await one.send("99")).text).toMatch(
      /^Pilihannya 1 sampai 10, jadi belum ada yang dicatat\.[\s\S]*\*Jenis bencana\*/,
    );
    expect((await one.send("1 2")).text).toMatch(/^Pilih satu jawaban saja/);
    expect((await draftOf(one.number)).revision).toBe(before.revision);
    expect((await one.send("entahlah")).text).toMatch(/Pesan itu belum menjawab pertanyaan ini/);
    const guessed = (await one.send("ada dua orang meninggal")).text;
    expect(guessed).toMatch(/^Dicatat\./);
    expect((await one.send("minta data korban seluruh indonesia")).text).toMatch(/^Layanan ini hanya menerima laporan/);
    expect((await one.send("ada banjir")).text).toContain("1. Banjir, sesuai cerita Anda");
    expect((await one.send("Banjir, sesuai cerita Anda")).text).toMatch(/^\*Karakteristik\*/);
  });

  test("Lainnya asks for its words, at once or with its number; none cannot go with others", async () => {
    const one = open();
    await known(one);
    await reach(one, /langkah 3 dari/);
    expect((await one.send("6 1")).text).toMatch(/tidak bisa dipilih bersama pilihan lain/);
    expect((await one.send("1 7")).text).toMatch(/^\*Lainnya\*\nTuliskan apa/);
    expect((await one.send("Balai desa")).text).toMatch(/langkah 4 dari/);
    expect((await one.send("1 6 Sumur tercemar")).text).toMatch(/langkah 5 dari/);
    await one.send("kembali");
    expect((await one.send("6")).text).toMatch(/Tuliskan apa/);
    expect((await one.send("kembali")).text).toMatch(/langkah 3 dari/);
  });

  test("a warning of the step answered comes with the next question", async () => {
    const one = open();
    await known(one);
    await reach(one, /langkah 2 dari/);
    expect((await one.send("2")).text).toMatch(/^Air yang naik cepat[\s\S]*langkah 3 dari/);
  });

  test("the chronology is shown, and a note may be added", async () => {
    const one = open();
    await known(one);
    const review = await reach(one, /^\*Kronologi tersusun/m);
    expect(review).toMatch(/Hujan dengan intensitas tinggi/);
    expect((await one.send("x".repeat(301))).text).toMatch(/terlalu panjang: 301 huruf/);
    expect((await one.send("kembali")).text).toMatch(/langkah 8 dari/);
    await one.send("1");
    expect((await one.send("Jembatan Uji terputus")).text).toMatch(/^\*Waktu kejadian\*/);
    expect((await states(one)).chronology).toMatchObject({ value: { note: "Jembatan Uji terputus" } });
    await one.send("kembali");
    expect((await one.send("lewati")).text).toMatch(/^\*Waktu kejadian\*/);
  });

  test("the time: a day and its hour, at once or after", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Waktu kejadian/m);
    expect((await one.send("kapan ya")).text).toMatch(/^Tanggal kejadian belum diisi/);
    expect((await one.send("9")).text).toMatch(/Tanggal kejadian belum diisi/);
    expect((await one.send("hari ini")).text).toMatch(/^\*Jam berapa\?\*[\s\S]*waktu WIB/);
    expect((await one.send("pagi-pagi")).text).toMatch(/^Jam belum terbaca[\s\S]*\*Jam berapa\?\*/);
    expect((await one.send("23.00")).text).toMatch(/^Waktu itu belum terjadi[\s\S]*\*Jam berapa\?\*/);
    expect((await one.send("kembali")).text).toMatch(/^\*Kronologi tersusun/);
    await one.send("lanjut");
    await one.send("2");
    expect((await one.send("tidak tahu")).text).toMatch(/^\*Korban/);
    expect((await states(one)).eventTime).toMatchObject({ value: { kind: "dateOnly", localDate: "2026-11-24" } });
    await one.send("kembali");
    expect((await one.send("3")).text).toMatch(/^\*Korban/);
    expect((await states(one)).eventTime).toMatchObject({ value: { kind: "olderThan30Days" } });
    await one.send("kembali");
    expect((await one.send("kemarin pukul 17.00")).text).toMatch(/^\*Korban/);
    expect((await states(one)).eventTime).toMatchObject({ value: { localTime: "17:00" } });
  });

  test("counts in order, by a sentence, or none (AC-03, AC-04)", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Korban/m);
    expect((await one.send("2 0")).text).toMatch(/^Yang ditanya 3 angka, yang terbaca 2/);
    expect((await one.send("2,5 0 0 0")).text).toMatch(/yang terbaca 5/);
    expect((await one.send("1.250 0 0")).text).toMatch(/angka bulat tanpa titik/);
    await one.send("2 0 -");
    const told = await states(one);
    expect([told.dead, told.missing, told.injured]).toEqual([
      { state: "value", value: 2, origin: "boxEntry" },
      { state: "none", origin: "boxEntry" },
      { state: "notYetKnown" },
    ]);
    await one.send("kembali");
    const { text } = await one.send("dua orang meninggal");
    expect(text).toContain("• Hilang\n• Luka-luka");
    expect((await states(one)).dead).toMatchObject({ value: 2, quote: "dua orang meninggal" });
  });

  test("a text answer, not known, or passed over", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Titik pengungsian/m, [[/^\*Pengungsian/m, "30 8"]]);
    expect((await one.send("x".repeat(301))).text).toMatch(/terlalu panjang: 301 huruf/);
    expect((await one.send("kembali")).text).toMatch(/^\*Pengungsian/);
    await one.send("30 8");
    expect((await one.send("lewati")).text).toMatch(/^\*Kerusakan rumah/);
    expect((await states(one)).shelters).toEqual({ state: "notYetKnown" });
    await one.send("kembali");
    await one.send("belum tahu");
    expect((await states(one)).shelters).toMatchObject({ state: "confirmedUnknown" });
  });

  test("a message over 2,000 letters is not taken", async () => {
    const one = open();
    await known(one);
    expect((await one.send("banjir ".repeat(300))).text).toMatch(/^Pesan terlalu panjang: 2\.099 dari/);
  });
});

describe("photos (AC-06)", () => {
  const photos = async (one: One) =>
    query<{ badge: string; lat: number | null; far: number; time_source: string; taken_at: string }>`
      select p.badge, p.lat, p.far, p.time_source, p.taken_at from draft_photo p join report_draft d on d.id = p.draft_id
      join reporter r on r.id = d.reporter_id where r.number = ${one.number} order by p.received_at`;

  test("placed by the location shared near them, before or after", async () => {
    const one = open();
    await known(one);
    expect(await one.photo(cameraJpeg())).toMatchObject({ status: 409 });
    expect((await one.photo(cameraJpeg())).text).toMatch(/^Foto diminta di akhir[\s\S]*\*RT dan RW\*/);
    clock.advance(31 * 60_000);
    const asked = await reach(one, /^\*Foto kejadian/m);
    expect(asked).toContain("1. Lanjut tanpa foto");
    const takenAt = clock.now() + 5_000;
    const first = await one.photo(cameraJpeg(), takenAt);
    expect(first.text).toMatch(
      /^\*Foto 1 dari 10 diterima\*\nTanpa lokasi\.[\s\S]*Bagikan juga lokasi Anda[\s\S]*1\. Lanjut$/,
    );
    expect(await photos(one)).toEqual([
      { badge: "none", lat: null, far: 0, time_source: "chatMessage", taken_at: new Date(takenAt).toISOString() },
    ]);
    expect((await one.share(VILLAGE.lat, VILLAGE.lon)).text).toMatch(/^Lokasi dicatat untuk 1 foto\./);
    expect(await photos(one)).toMatchObject([{ badge: "chatLocation", lat: VILLAGE.lat, far: 0 }]);
    expect((await one.share(VILLAGE.lat + 1, VILLAGE.lon)).text).toMatch(/^Lokasi dicatat untuk foto berikutnya/);
    expect((await one.photo(cameraJpeg(), clock.now())).text).toContain(
      "Lokasi dibagikan lewat WhatsApp, jauh dari lokasi kejadian.",
    );
    clock.advance(31 * 60_000);
    const unplaced = (await one.photo(cameraJpeg())).text;
    expect(unplaced).toContain("Tanpa lokasi.");
    // The location is asked for once.
    expect(unplaced).not.toContain("Bagikan juga lokasi");
    expect(await photos(one)).toMatchObject([
      { badge: "chatLocation", far: 0 },
      { badge: "chatLocation", far: 1 },
      { badge: "none", time_source: "chatMessage" },
    ]);
    // A photo over 30 minutes before the location is not placed by it.
    clock.advance(31 * 60_000);
    expect((await one.share(VILLAGE.lat, VILLAGE.lon)).text).toMatch(/^Lokasi dicatat untuk foto berikutnya/);
    expect((await one.send("lanjut")).text).toMatch(/3 foto, 2 dengan lokasi terekam/);
  });

  test("sent by mistake, the last one is taken back in the photo step", async () => {
    const one = open();
    await known(one);
    expect((await one.send("hapus foto")).text).toMatch(/^Belum ada foto yang bisa dihapus[\s\S]*\*RT dan RW\*/);
    await reach(one, /^\*Foto kejadian/m);
    expect((await one.send("hapus foto")).text).toMatch(/^Belum ada foto yang bisa dihapus/);
    expect((await one.photo(cameraJpeg())).text).toContain("Salah foto? Ketik *hapus foto*");
    await one.photo(cameraJpeg());
    expect((await one.send("hapus foto")).text).toMatch(/^Foto terakhir sudah dihapus\.\n\n\*Foto 1 dari 10/);
    expect((await one.send("hapus")).text).toMatch(/^Foto terakhir sudah dihapus\.\n\n\*Foto kejadian\*/);
    expect(await photos(one)).toEqual([]);
  });

  test("refused when it is no photo, or one too many", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Foto kejadian/m);
    const wrong = await one.photo(new Uint8Array(5000));
    expect([wrong.status, wrong.text.startsWith("Foto harus JPEG dan paling besar 5 MB")]).toEqual([409, true]);
    const broken = cameraJpeg().subarray(0, 2000);
    expect((await one.photo(broken)).text).toMatch(/^Foto ini tidak terbaca/);
    for (let count = 0; count < 10; count += 1) expect((await one.photo(cameraJpeg())).status).toBe(200);
    expect((await one.photo(cameraJpeg())).text).toMatch(/^Foto sudah sebanyak yang bisa disimpan/);
    expect(await photos(one)).toHaveLength(10);
  });

  test("with no report open, a known number is told how to start", async () => {
    const one = open();
    await sent(one);
    const photo = await one.photo(cameraJpeg());
    expect([photo.status, photo.text]).toEqual([
      409,
      "Foto ini belum disimpan karena belum ada laporan. Ketik *lapor* untuk mulai, foto diminta di akhir.",
    ]);
  });

  test("photos of the web without a place are not placed by the chat", async () => {
    const place = { badge: "chatLocation", point: VILLAGE, far: false } as const;
    expect(await placeChatPhotos(bindings.db, crypto.randomUUID(), place, new Date(0))).toBe(0);
  });
});

describe("the summary", () => {
  test("a part is opened by its number, or put right in words", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Ringkasan laporan/m);
    const groups = (await one.send("2")).text;
    expect(groups).toMatch(/^\*Ubah bagian mana\?\*\n\n1\. Kejadian\n2\. Korban/);
    expect((await one.send("99")).text).toMatch(/^Pilihannya 1 sampai \d+[\s\S]*Ubah bagian mana/);
    expect((await one.send("korban")).text).toContain("• Meninggal: 0");
    expect((await one.send("- - 4")).text).toMatch(/dirawat inap/);
    const back = (await one.send("1")).text;
    expect(back).toContain("Luka-luka: 4 orang");
    // Not known kept what was there.
    expect(back).toContain("Meninggal: tidak ada");
    await one.send("2");
    expect((await one.send("tiga orang meninggal")).text).toContain("Meninggal: 3 orang");
    expect((await one.send("terima kasih")).text).toMatch(/^Bila ada nyawa[\s\S]*belum menjawab[\s\S]*\*ulangi\*/);
    expect((await one.send("9")).text).toMatch(/^Pilihannya 1 sampai 3[\s\S]*\*ulangi\*/);
    expect((await one.send("bantuan")).text).toMatch(/\*Cara menjawab\*[\s\S]*\*ulangi\*/);
    expect((await one.send("ulangi")).text).toContain("Pelapor: Uji Satu (Warga)");
  });

  test("cancelling asks first, and removes everything", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Ringkasan laporan/m);
    expect((await one.send("3")).text).toMatch(/^\*Batalkan laporan ini\?\*[\s\S]*1\. Ya, batalkan/);
    expect((await one.send("hmm")).text).toMatch(/^Jawaban itu belum terbaca/);
    expect((await one.send("tidak")).text).toContain("Ringkasan laporan");
    await one.send("batal");
    expect((await one.send("ya")).text).toMatch(/^\*Laporan dibatalkan\*/);
    expect((await draftOf(one.number)).state).toBe("cancelled");
    expect((await one.send("halo")).text).toMatch(/^\*Pantau Bencana BNPB\*\nKetik salah satu/);
  });

  test("the sixth report in 24 hours waits, and a send that fails keeps every answer", async () => {
    const one = open();
    await known(one);
    await reach(one, /^\*Ringkasan laporan/m);
    const failing = door({ FAULT_SEND: "on" }, new Date(clock.now()).toISOString()).open(one.number);
    expect((await failing.send("1")).text).toMatch(/^Laporan belum terkirim karena layanan sedang terganggu/);
    for (let n = 1; n <= 5; n += 1) {
      const id = crypto.randomUUID();
      const at = new Date(clock.now() - n * 3_600_000);
      await query`insert into report_draft (id, reporter_id, owner_slot, state, created_at, last_acted_at, ended_at)
        select ${id}, r.id, 'session', 'sent', ${at}, ${at}, ${at} from reporter r where r.number = ${one.number}`;
      await query`insert into report (id, ticket_number, draft_id, reporter_id, number_key, owner_slot,
          number_unverified, hazard_type, village_code, district_code, regency_code, province_code, sent_at)
        select ${crypto.randomUUID()}, ${`LA-010140-${n}${Math.floor(Math.random() * 1e6)}`}, ${id}, r.id, r.number_key,
          'session', 0, 'flood', '11.08.01.2001', '11.08.01', '11.08', '11', ${at}
        from reporter r where r.number = ${one.number}`;
    }
    expect((await one.send("1")).text).toMatch(
      /^Batas laporan tercapai[\s\S]*Kirim lagi pukul [\s\S]*Ringkasan laporan/,
    );
  });
});

describe("reports already sent", () => {
  test("status lists what came from the chat, not what a phone typed the number for (AC-08)", async () => {
    const one = open();
    expect((await one.send("status")).text).toContain("1. Setuju");
    const ticket = await sent(one);
    const { text } = await one.send("status");
    expect(text).toContain(`*${ticket}*\nBanjir, 25 November 2026\nStatus: Laporan diterima`);
    expect(text).toContain(`*status ${ticket}*`);
    expect((await one.send(`status ${ticket}`)).text).toMatch(/Lacak laporan: .*#t=[0-9a-f]{32}$/);
    expect((await one.send("status LA-010101-99")).text).toMatch(/^Laporan LA-010101-99 tidak ditemukan/);
    const [own] = await query<{ id: string }>`select id from report where ticket_number = ${ticket}`;
    await query`update report set owner_slot = 'a-phone' where id = ${own?.id}`;
    expect((await one.send("status")).text).toMatch(/^Belum ada laporan terkirim dari chat ini/);
    await query`update report set owner_slot = 'session' where id = ${own?.id}`;
    await one.send("lapor");
    expect((await one.send("status")).text).toMatch(/Laporan diterima[\s\S]*\*Lokasi kejadian\*/);
  });

  test("more than five are counted", async () => {
    const one = open();
    const ticket = await sent(one);
    for (let n = 1; n <= 6; n += 1) {
      const [id, draft, at] = [crypto.randomUUID(), crypto.randomUUID(), new Date(clock.now() - n * 86_400_000)];
      const number = `LA-020140-${n}${Math.floor(Math.random() * 1e6)}`;
      await query`insert into report_draft (id, reporter_id, owner_slot, state, created_at, last_acted_at, ended_at)
        select ${draft}, reporter_id, owner_slot, 'sent', ${at}, ${at}, ${at} from report where ticket_number = ${ticket}`;
      await query`insert into report (id, ticket_number, draft_id, reporter_id, number_key, owner_slot,
          number_unverified, hazard_type, village_code, district_code, regency_code, province_code, sent_at)
        select ${id}, ${number}, ${draft}, reporter_id, number_key, owner_slot, 0, 'other', village_code,
          district_code, regency_code, province_code, ${at} from report where ticket_number = ${ticket}`;
      await query`insert into report_version (report_id, version, fields, reporter_name, reporter_number, reporter_role,
          privacy_version, consent_agreed_at, complete_percent, created_at)
        select ${id}, 1, '{}', 'Uji Satu', ${one.number}, 'citizen', 1, ${at}, 10, ${at}`;
      await query`insert into ticket (ticket_number, report_id, status, updated_at) values (${number}, ${id}, 'closed', ${at})`;
    }
    const { text } = await one.send("status");
    expect(text).toContain("Jenis belum diketahui");
    expect(text).toContain("Dan 2 laporan lebih lama.");
  });

  test("news in words makes the next version (AC-09)", async () => {
    const one = open();
    const ticket = await sent(one);
    expect((await one.send("kabar")).text).toMatch(
      new RegExp(`^\\*Tambah kabar untuk ${ticket}\\*[\\s\\S]*Belum ada yang berubah`),
    );
    expect((await one.send("1")).text).toMatch(/^Belum ada yang berubah|belum/i);
    const told = (await one.send("mengungsi 30 orang")).text;
    expect(told).toMatch(/\*Titik pengungsian\*/);
    const review = (await one.send("lewati")).text;
    expect(review).toContain("*Yang akan dikirim*\n• Mengungsi: tidak ada menjadi 30 orang");
    expect((await one.send(`kabar ${ticket}`)).text).toContain("*Yang akan dikirim*");
    expect((await one.send("kabar LA-010101-99")).text).toMatch(/^Selesaikan dulu laporan ini/);
    const groups = (await one.send("2")).text;
    expect(groups).toMatch(/Korban[\s\S]*Tambah foto$/);
    expect((await one.send("tambah foto")).text).toMatch(/^\*Foto kejadian\*/);
    await one.photo(cameraJpeg());
    expect((await one.send("1")).text).toContain("• 1 foto baru");
    expect((await one.send("1")).text).toBe(`*Kabar terkirim*\nLaporan ${ticket} sekarang versi 2.`);
    expect((await version(ticket, 2)).displacedPeople).toMatchObject({ value: 30, quote: "mengungsi 30" });
    expect((await version(ticket)).displacedPeople).toMatchObject({ state: "none" });
  });

  test("a message that names a ticket is news of it", async () => {
    const one = open();
    const ticket = await sent(one);
    expect((await one.send(`${ticket}: luka 4`)).text).toMatch(/dirawat inap/);
    await one.send("batal");
    expect((await one.send("1")).text).toBe(`*Kabar dibatalkan*\nLaporan ${ticket} tidak berubah.`);
    expect((await one.send("LA-010101-99 air naik")).text).toMatch(/^Laporan LA-010101-99 tidak ditemukan/);
    await one.send("lapor");
    expect((await one.send(`kabar ${ticket}`)).text).toMatch(/^Selesaikan dulu laporan ini[\s\S]*\*Lokasi kejadian\*/);
  });

  test("an event told within reach of a report asks which it is about", async () => {
    const later = door();
    const one = later.open();
    const first = await sent(one);
    const asked = (await one.send("air naik lagi, mengungsi 30 orang")).text;
    expect(asked).toBe(
      `*Kabar ini tentang apa?*\n\n1. Kabar untuk ${first} (Banjir)\n2. Laporan baru\n\nBalas dengan angkanya.`,
    );
    expect((await one.send("3")).text).toMatch(/^Pilihannya 1 sampai 2[\s\S]*Laporan baru/);
    expect((await one.send("1")).text).toMatch(/Titik pengungsian/);
    await one.send("batal");
    await one.send("1");
    await one.send("banjir lagi");
    expect((await one.send("laporan baru")).text).toMatch(/^Melapor sebagai|Lokasi kejadian/);
    await one.send("batal");
    await one.send("1");
    await one.send("banjir lagi");
    const fresh = (await one.send("2")).text;
    expect(fresh).toMatch(/^Melapor sebagai Uji Satu[\s\S]*\*Lokasi kejadian\*/);
    await one.send("batal");
    await one.send("1");
    // Anything else leaves the question behind.
    await one.send("banjir lagi");
    expect((await one.send("terima kasih")).text).toMatch(/^Sama-sama/);
    // No event is named, but near a report a sentence may be news of it; two words are not.
    expect((await one.send("sungai sudah meluap")).text).toMatch(/^\*Kabar ini tentang apa\?\*/);
    expect((await one.send("selamat pagi")).text).toMatch(/Ketik salah satu/);
    const second = await sentAgain(one);
    const which = (await one.send("kabar")).text;
    expect(which).toContain(`1. Kabar untuk ${second} (Banjir)\n2. Kabar untuk ${first} (Banjir)`);
    expect(which).not.toContain("Laporan baru");
    expect((await one.send("2")).text).toMatch(new RegExp(`^\\*Tambah kabar untuk ${first}`));
    await one.send("batal");
    await one.send("1");
    later.clock.advance(73 * 3_600_000);
    expect((await one.send(`kabar ${first}`)).text).toMatch(/^Kabar bisa ditambah sampai 72 jam/);
    expect((await one.send("kabar")).text).toMatch(/^Belum ada laporan dari chat ini yang bisa ditambah kabar/);
    expect((await one.send("sungai sudah meluap")).text).toMatch(/Ketik salah satu/);
  });

  test("news told too late to send says why", async () => {
    const later = door();
    const one = later.open();
    const ticket = await sent(one);
    later.clock.advance(60 * 3_600_000);
    await one.send(`kabar ${ticket}`);
    await one.send("lima orang meninggal");
    later.clock.advance(13 * 3_600_000);
    expect((await one.send("1")).text).toMatch(/^Kabar bisa ditambah sampai 72 jam[\s\S]*\*Tambah kabar untuk/);
  });
});

async function sentAgain(one: One): Promise<string> {
  await one.send("lapor");
  await one.share(VILLAGE.lat, VILLAGE.lon);
  await one.send("1");
  await reach(one, /^\*Ringkasan laporan/m);
  const { text } = await one.send("1");
  return (/LA-\d{6}-\d{2,}/.exec(text) as RegExpExecArray)[0];
}

describe("an emergency", () => {
  test("place, kind and victims, then sent", async () => {
    const one = open();
    await sent(one);
    expect((await one.send("darurat")).text).toMatch(/hubungi 112[\s\S]*\*Lokasi kejadian\*/);
    await one.share(VILLAGE.lat, VILLAGE.lon);
    expect((await one.send("1")).text).toMatch(/^\*Kejadian apa yang sedang terjadi\?\*/);
    expect((await one.send("banjir")).text).toMatch(/Ada orang terluka, hilang, atau terjebak\?/);
    expect((await one.send("ya")).text).toMatch(/terjebak atau terseret air/);
    expect((await one.send("tidak tahu")).text).toMatch(/pertolongan medis/);
    expect((await one.send("tidak tahu")).text).toMatch(/^\*Foto kejadian\*/);
    const summary = (await one.send("tidak")).text;
    expect(summary).toContain("*Laporan darurat, sedang berlangsung*\nOrang terluka, hilang, atau terjebak: Ya, ada");
    const { text } = await one.send("1");
    const ticket = (/LA-\d{6}-\d{2,}/.exec(text) as RegExpExecArray)[0];
    expect(await query`select emergency, emergency_victims, door from report where ticket_number = ${ticket}`).toEqual([
      { emergency: "chat", emergency_victims: "yes", door: "chat" },
    ]);
  });

  test("an open report becomes one, and news not sent gives way to one", async () => {
    const one = open();
    const ticket = await sent(one);
    await one.send("lapor");
    expect((await one.send("darurat")).text).toMatch(/^Laporan ini sekarang laporan darurat[\s\S]*\*Lokasi kejadian\*/);
    await one.send("batal");
    await one.send("1");
    await one.send(`kabar ${ticket}`);
    expect((await one.send("lapor darurat")).text).toMatch(/^Melapor sebagai[\s\S]*\*Lokasi kejadian\*/);
    expect((await draftOf(one.number)).fields).toMatchObject({ emergency: { victims: null } });
  });

  test("an unknown number agrees first, and is then in an emergency", async () => {
    const one = open();
    for (const text of ["darurat", "1", "1", "Uji Satu"]) await one.send(text);
    await one.share(VILLAGE.lat, VILLAGE.lon);
    expect((await one.send("1")).text).toMatch(/^\*Kejadian apa yang sedang terjadi/);
  });

  test("a command is nobody's name, and whoever asks for their data to go is told how", async () => {
    const one = open();
    const rights = /^\*Menghapus data Anda\*[\s\S]*persuratan@bnpb\.go\.id[\s\S]*\/privacy/;
    expect((await one.send("hapus data saya")).text).toMatch(rights);
    for (const text of ["lapor", "1", "1"]) await one.send(text);
    expect((await one.send("status")).text).toMatch(/^Jawaban itu belum terbaca[\s\S]*Nama Anda/);
    expect((await one.send("hapus data saya")).text).toMatch(/^\*Menghapus data Anda\*[\s\S]*Nama Anda/);
    expect((await one.send("Uji Satu")).text).toMatch(/^Melapor sebagai Uji Satu/);
    expect((await one.send("hapus data saya")).text).toMatch(/^\*Menghapus data Anda\*[\s\S]*\*Lokasi kejadian\*/);
    await one.send("batal");
    await one.send("1");
    expect((await one.send("hapus data saya")).text).toMatch(rights);
  });

  test("lapor and ulangi ask the same again, and blame nobody", async () => {
    const one = open();
    const consent = (await one.send("lapor")).text;
    for (const text of ["lapor", "ulangi"]) {
      const again = (await one.send(text)).text;
      expect(consent.endsWith(again), again).toBe(true);
    }
  });

  test("said while the reporter is being asked who they are, it is no name of theirs", async () => {
    const one = open();
    for (const text of ["lapor", "1", "1"]) await one.send(text);
    expect((await one.send("darurat")).text).toMatch(
      /^Laporan ini sekarang laporan darurat[\s\S]*hubungi 112[\s\S]*nama/i,
    );
    expect((await one.send("Uji Satu")).text).toMatch(/^Melapor sebagai Uji Satu \(Warga\)/);
    expect((await draftOf(one.number)).fields).toMatchObject({ emergency: { victims: null } });
    await one.send("batal");
    await one.send("1");
    // Known by now, they are not held up by a new name.
    await one.send("ganti nama");
    expect((await one.send("darurat")).text).toMatch(/^Melapor sebagai Uji Satu[\s\S]*\*Lokasi kejadian\*/);
  });
});

describe("the name", () => {
  test("is changed in the middle of a report, or kept", async () => {
    const one = open();
    await known(one);
    expect((await one.send("ganti nama")).text).toMatch(/^\*Melapor sebagai\*/);
    expect((await one.send("batal")).text).toBe("Nama pelapor tidak diganti.");
    expect((await one.send("ulangi")).text).toMatch(/^\*RT dan RW\*/);
    await one.send("ganti nama");
    await one.send("1");
    expect((await one.send("Uji Tiga")).text).toMatch(/^Melapor sebagai Uji Tiga \(Warga\)[\s\S]*\*RT dan RW\*/);
    const consents = await query<{ agreed_at: string }>`select c.agreed_at from reporter_consent c
      join reporter_profile p on p.id = c.profile_id join reporter r on r.id = p.reporter_id where r.number = ${one.number}`;
    expect(new Set(consents.map((consent) => consent.agreed_at)).size).toBe(1);
  });

  test("with no report open it starts none, and news not sent yet stays", async () => {
    const one = open();
    const ticket = await sent(one);
    expect((await one.send("ganti nama")).text).toMatch(/^\*Melapor sebagai\*/);
    await one.send("2");
    await one.send("Uji Empat");
    await one.send("Kabupaten Uji");
    expect((await one.send("Staf")).text).toMatch(/^Melapor sebagai Uji Empat \(Petugas BPBD\)[\s\S]*Ketik salah satu/);
    expect((await draftOf(one.number)).state).toBe("sent");
    await one.send(`kabar ${ticket}`);
    await one.send("lima rumah rusak berat");
    for (const text of ["ganti nama", "1"]) await one.send(text);
    expect((await one.send("Uji Lima")).text).toMatch(/^Melapor sebagai Uji Lima \(Warga\)[\s\S]*Yang akan dikirim/);
  });
});

describe("limits and time", () => {
  test("the 21st message of a minute waits, and says until when", async () => {
    const still = manualClock(START);
    const one = chat(
      (request) => api.app.fetch(request, testBindings({ GATEWAY_SECRETS }, { clock: still }).bindings),
      {
        now: still.now,
      },
    );
    for (let count = 0; count < 20; count += 1) expect((await one.send("halo")).status).toBe(200);
    const refused = await one.send("halo");
    expect(refused).toMatchObject({ status: 429, json: { sisaDetik: 60 } });
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(refused.text).toBe(
      "Batas pesan untuk nomor ini tercapai. Laporan Anda tetap tersimpan. Lanjutkan lagi pukul 10.01 WIB. Bila nyawa terancam, telepon 112.",
    );
    expect((await one.photo(cameraJpeg())).status).toBe(429);
  });

  test("a report left 24 hours is gone, and the chat says so", async () => {
    const later = door();
    const one = later.open();
    await known(one);
    later.clock.advance(25 * 3_600_000);
    expect((await one.send("halo")).text).toMatch(
      /^Laporan yang belum selesai sudah 24 jam tidak diisi[\s\S]*Ketik salah satu/,
    );
    expect((await one.send("halo")).text).toMatch(/^\*Pantau Bencana/);
  });

  test("a step left 24 hours is forgotten", async () => {
    const later = door();
    const one = later.open();
    await one.send("lapor");
    await one.send("1");
    later.clock.advance(25 * 3_600_000);
    expect((await one.send("1")).text).toContain("1. Setuju");
  });
});
