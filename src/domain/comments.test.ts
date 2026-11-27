import { describe, expect, test } from "vitest";
import { COMMENT_MAX, cleanComment, figuresFrom, mayHoldFigures } from "./comments";

const kept = (typed: string) => {
  const cleaned = cleanComment(typed);
  return cleaned.kind === "ok" ? cleaned.text : `${cleaned.kind}:${cleaned.rule}`;
};

describe("a comment cleaned for the card", () => {
  test("keeps what is said of the event, its spaces tidied", () => {
    expect(kept("  Air   sudah surut,\n\n\n\nwarga mulai pulang  ")).toBe("Air sudah surut,\n\nwarga mulai pulang");
    expect(kept("jalan desa tertutup longsor")).toBe("jalan desa tertutup longsor");
    expect(kept("ok")).toBe("ok");
  });

  test("takes out contacts: numbers however written, emails, accounts and links", () => {
    expect(kept("hubungi 0812-3456-7890 ya")).toBe("hubungi [nomor dihapus] ya");
    expect(kept("hubungi +62 812 3456 7890")).toBe("hubungi [nomor dihapus]");
    expect(kept("wa 62 8123 4567 890")).toBe("wa [nomor dihapus]");
    expect(kept("hubungi 0812/3456/7890")).toBe("hubungi [nomor dihapus]");
    expect(kept("nik 1234567890123456")).toBe("nik [nomor dihapus]");
    expect(kept("kode 12 345 678 90")).toBe("kode [nomor dihapus]");
    expect(kept("kirim ke a.b@mail.id")).toBe("kirim ke [email dihapus]");
    expect(kept("kirim ke ab (at) mail (dot) com")).toBe("kirim ke [email dihapus]");
    expect(kept("kirim ke ab[at]mail.com")).toBe("kirim ke [email dihapus]");
    expect(kept("ikuti @posko_desa.1 dan @a")).toBe("ikuti [akun dihapus] dan @a");
    expect(kept("lihat https://contoh.id/x dan www.contoh.id")).toBe("lihat [tautan dihapus] dan [tautan dihapus]");
    expect(kept("lihat linktr.ee/posko")).toBe("lihat [tautan dihapus]");
    expect(kept("lihat posko.com, bukan posko.lain")).toBe("lihat [tautan dihapus], bukan posko.lain");
    expect(kept("a​0812​3456​7890")).toBe("a[nomor dihapus]");
    expect(kept("０８１２３４５６７８９０")).toBe("[nomor dihapus]");
    expect(kept("x\u0007y\u007Fz")).toBe("xyz");
    expect(kept("x\ty")).toBe("x y");
  });

  test("takes out an address finer than the village", () => {
    expect(kept("di RT 03 RW 05 banjir")).toBe("di [RT/RW dihapus] banjir");
    expect(kept("di rt.3/rw.5 banjir")).toBe("di [RT/RW dihapus] banjir");
    expect(kept("di rukun tetangga 2 banjir")).toBe("di [RT/RW dihapus] banjir");
    expect(kept("Jl. Melati 12 terendam")).toBe("[alamat dihapus] terendam");
    expect(kept("gg Mawar no 4")).toBe("[alamat dihapus]");
    expect(kept("di Blok C3")).toBe("di [alamat dihapus]");
    expect(kept("di Jalan Melati Indah No. 12 terendam")).toBe("di [alamat dihapus] terendam");
    expect(kept("di Perumahan Griya terendam")).toBe("di [alamat dihapus] terendam");
    expect(kept("blokade di jalan desa")).toBe("blokade di jalan desa");
    expect(kept("rumah nomor 7 roboh")).toBe("rumah [nomor rumah dihapus] roboh");
    expect(kept("rumah no.7a roboh")).toBe("rumah [nomor rumah dihapus] roboh");
  });

  test("refuses rude words, a long run of one letter, nothing, and too much", () => {
    expect(kept("dasar goblok")).toBe("refused:rude");
    expect(kept("Bangsat!")).toBe("refused:rude");
    expect(kept("anjing lu")).toBe("refused:rude");
    expect(kept("anjing liar masuk desa")).toBe("anjing liar masuk desa");
    expect(kept("pak tololo")).toBe("pak tololo");
    expect(kept("tolong!!!!!!!!")).toBe("refused:repeated");
    expect(kept("tolong!!!!!!!")).toBe("tolong!!!!!!!");
    expect(kept(" a ")).toBe("refused:empty");
    expect(kept("x".repeat(COMMENT_MAX))).toBe("refused:repeated");
    expect(kept("ab ".repeat(COMMENT_MAX / 3 + 1))).toBe("refused:tooLong");
    expect(kept("ab".repeat(COMMENT_MAX / 2))).toHaveLength(COMMENT_MAX);
    // A token longer than what it replaced can carry it over.
    expect(kept("@ab ".repeat(100))).toBe("refused:tooLong");
  });
});

describe("figures from a comment", () => {
  const said = "Di dusun kami tiga orang meninggal, 120 warga mengungsi. Tidak ada yang hilang.";

  test("are kept only quoted word for word, with their own word and number in the quote", () => {
    expect(
      figuresFrom(
        {
          figures: [
            { figure: "dead", value: 3, quote: "tiga orang meninggal" },
            { figure: "displaced", value: 120, quote: "120 warga mengungsi" },
            { figure: "missing", value: 0, quote: "Tidak ada yang hilang" },
          ],
        },
        said,
      ),
    ).toEqual([
      { figure: "dead", value: 3, quote: "tiga orang meninggal" },
      { figure: "displaced", value: 120, quote: "120 warga mengungsi" },
      { figure: "missing", value: 0, quote: "tidak ada yang hilang" },
    ]);
  });

  test("refuse a figure not named, a second of one figure, a quote not said or without its word or number", () => {
    const one = (item: object) => figuresFrom({ figures: [item] }, said);
    expect(one({ figure: "roads", value: 3, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "dead", value: 3, quote: "empat orang meninggal" })).toEqual([]);
    expect(one({ figure: "injured", value: 3, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "dead", value: 4, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "dead", value: 3.5, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "dead", value: -3, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "dead", value: "3", quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "dead", value: 3, quote: 3 })).toEqual([]);
    expect(one({ figure: "dead", value: 120, quote: "120 warga mengungsi" })).toEqual([]);
    expect(one({ figure: "displaced", value: 3, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "houses", value: 3, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "flooded", value: 3, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "dead", value: 3, quote: "  Tiga orang meninggal  " })).toEqual([
      { figure: "dead", value: 3, quote: "tiga orang meninggal" },
    ]);
    expect(one({ figure: "dead", value: 3, quote: "   " })).toEqual([]);
    expect(one({ figure: "dead", value: 0, quote: "tiga orang meninggal" })).toEqual([]);
    expect(one({ figure: "missing", value: 0, quote: "yang hilang" })).toEqual([]);
    expect(
      figuresFrom(
        {
          figures: [
            { figure: "dead", value: 3, quote: "tiga orang meninggal" },
            { figure: "dead", value: 120, quote: "120 warga mengungsi" },
          ],
        },
        said,
      ),
    ).toEqual([{ figure: "dead", value: 3, quote: "tiga orang meninggal" }]);
    expect(figuresFrom({ figures: [null, 1] }, said)).toEqual([]);
    expect(figuresFrom({ figures: "dead" }, said)).toEqual([]);
    expect(figuresFrom(null, said)).toEqual([]);
    expect(figuresFrom({ figures: 5 }, said)).toEqual([]);
  });

  test("hold the largest figure the desk may take, a word that is only part of another refused", () => {
    const big = "100000 rumah terendam, 100001 rumah rusak";
    expect(
      figuresFrom({ figures: [{ figure: "flooded", value: 100_000, quote: "100000 rumah terendam" }] }, big),
    ).toEqual([{ figure: "flooded", value: 100_000, quote: "100000 rumah terendam" }]);
    expect(figuresFrom({ figures: [{ figure: "houses", value: 100_001, quote: "100001 rumah rusak" }] }, big)).toEqual(
      [],
    );
    expect(
      figuresFrom({ figures: [{ figure: "injured", value: 2, quote: "2 orang jaluka" }] }, "2 orang jaluka"),
    ).toEqual([]);
    const long = `${"x".repeat(200)} 2 orang luka`;
    expect(figuresFrom({ figures: [{ figure: "injured", value: 2, quote: long }] }, long)).toEqual([]);
    expect(
      figuresFrom(
        { figures: [{ figure: "missing", value: 0, quote: "nihil, sama sekali tak ada warga yang hilang" }] },
        "nihil, sama sekali tak ada warga yang hilang",
      ),
    ).toEqual([]);
    expect(
      figuresFrom({ figures: [{ figure: "missing", value: 0, quote: "nihil warga hilang" }] }, "nihil warga hilang"),
    ).toEqual([{ figure: "missing", value: 0, quote: "nihil warga hilang" }]);
  });

  test("are asked of the model only for a comment with a number or a none", () => {
    expect(mayHoldFigures("air sudah surut")).toBe(false);
    expect(mayHoldFigures("dua rumah rusak")).toBe(true);
    expect(mayHoldFigures("korban nihil")).toBe(true);
    expect(mayHoldFigures("Tidak ada korban")).toBe(true);
    expect(mayHoldFigures("nolong warga")).toBe(false);
  });
});
