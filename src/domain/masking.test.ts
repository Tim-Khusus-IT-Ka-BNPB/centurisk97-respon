import { describe, expect, test } from "vitest";
import { maskText } from "./masking";

const reporter = { name: "Uji Satu", number: "+6280000000001" };
const nobody = { name: null, number: null };

describe("masking before the model and before storage", () => {
  test("the reporter's own name, own number and a NIK leave the message", () => {
    expect(maskText("saya Uji Satu, nomor 0800 0000 0001, NIK 3201010101010001", reporter)).toBe(
      "saya [nama pelapor], nomor [nomor HP], NIK [NIK]",
    );
  });

  test("a stored note keeps other names but loses numbers, ids and email", () => {
    expect(
      maskText(
        "Uji Satu melihat air di Desa Satu Jaya, Pak Contoh 0800 0000 0005 NIK 3201010101010002 uji@contoh.test",
        reporter,
      ),
    ).toBe("[nama pelapor] melihat air di Desa Satu Jaya, Pak Contoh [nomor HP] NIK [NIK] [email]");
  });

  test("the own name matches whole words in any case and spacing", () => {
    expect(maskText("UJI   satu datang", reporter)).toBe("[nama pelapor] datang");
    expect(maskText("Uji Satunya datang", reporter)).toBe("Uji Satunya datang");
    expect(maskText("PakUji Satu datang", reporter)).toBe("PakUji Satu datang");
    expect(maskText("Uji saja datang", reporter)).toBe("Uji saja datang");
  });

  test("a name with pattern characters is matched literally", () => {
    expect(maskText("A.B. hadir, AxBx tidak", { name: "A.B.", number: null })).toBe("[nama pelapor] hadir, AxBx tidak");
    expect(maskText("hanya , spasi", { name: "   ", number: null })).toBe("hanya , spasi");
    expect(maskText("hanya , spasi", { name: "", number: null })).toBe("hanya , spasi");
  });

  test("the own number in every written form", () => {
    for (const written of [
      "080000000001",
      "0800-0000-0001",
      "6280000000001",
      "+62 800 0000 0001",
      "+62.800.0000.0001",
      "800 0000 0001",
    ]) {
      expect(maskText(`hubungi ${written} ya`, reporter)).toBe("hubungi [nomor HP] ya");
    }
  });

  test("a longer digit run that only starts like the own number stays a count list", () => {
    expect(maskText("80000000001234 x", { name: null, number: "+6280000000001" })).toBe("80000000001234 x");
    expect(maskText("980000000001 x", { name: null, number: "+6280000000001" })).toBe("980000000001 x");
    expect(maskText("+80000000001 x", { name: null, number: "+6280000000001" })).toBe("+80000000001 x");
  });

  test("the own number is masked every time it appears", () => {
    expect(maskText("080000000001 dan 080000000001", { name: null, number: "+6280000000001" })).toBe(
      "[nomor HP] dan [nomor HP]",
    );
    expect(maskText("800 0000 0001 dan 800 0000 0001", { name: null, number: "+6280000000001" })).toBe(
      "[nomor HP] dan [nomor HP]",
    );
  });

  test("with no name or number nothing of the reporter is looked for", () => {
    expect(maskText("null", nobody)).toBe("null");
  });

  test("a malformed stored number masks nothing of its own", () => {
    for (const number of ["6280000000001", "x+6280000000001", "+6280000000001x"]) {
      expect(maskText("kode 80000000001", { name: null, number })).toBe("kode 80000000001");
    }
  });

  test("ported pattern rules: phone numbers of anyone", () => {
    expect(maskText("telp 081234567890.", nobody)).toBe("telp [nomor HP].");
    expect(maskText("telp +62 812-3456-7890", nobody)).toBe("telp [nomor HP]");
    expect(maskText("telp 62812345678", nobody)).toBe("telp [nomor HP]");
    expect(maskText("telp (0812) 3456 7890", nobody)).toBe("telp [nomor HP]");
    expect(maskText("telp (+62 812) 345-67", nobody)).toBe("telp [nomor HP]");
    expect(maskText("telp (0812)3456 7890.", nobody)).toBe("telp [nomor HP].");
    expect(maskText("telp (0812) 3456 78 90", nobody)).toBe("telp [nomor HP]");
    expect(maskText("telp (0812) 345678", nobody)).toBe("telp [nomor HP]");
    expect(maskText("telp (0812) 1 2345 678", nobody)).toBe("telp (0812) 1 2345 678");
  });

  test("short or non mobile digit runs are not phone numbers", () => {
    expect(maskText("08123456 orang", nobody)).toBe("08123456 orang");
    expect(maskText("0212345678901", nobody)).toBe("0212345678901");
    expect(maskText("x+081234567890", nobody)).toBe("x+081234567890");
    expect(maskText("5081234567890", nobody)).toBe("5081234567890");
    expect(maskText("08123456789012345", nobody)).toBe("08123456789012345");
  });

  test("ported pattern rules: a NIK in up to four groups", () => {
    expect(maskText("nik 3201010101010001", nobody)).toBe("nik [NIK]");
    expect(maskText("nik 3201 0101 0101 0001", nobody)).toBe("nik [NIK]");
    expect(maskText("nik 320101-01-01-010001", nobody)).toBe("nik [NIK]");
    expect(maskText("nik 320101.010101.0001", nobody)).toBe("nik [NIK]");
  });

  test("count lists, decimals and other lengths are not a NIK", () => {
    expect(maskText("10 20 30 40 50 60 70 80", nobody)).toBe("10 20 30 40 50 60 70 80");
    expect(maskText("32010101 01010001 1 2", nobody)).toBe("32010101 01010001 1 2");
    expect(maskText("320101010101000", nobody)).toBe("320101010101000");
    expect(maskText("32010101010100012", nobody)).toBe("32010101010100012");
    expect(maskText("1.3201010101010001", nobody)).toBe("1.3201010101010001");
    expect(maskText("3201010101010001,5", nobody)).toBe("3201010101010001,5");
  });

  test("ported pattern rules: email addresses", () => {
    expect(maskText("surel a.b+c@sub.contoh.co.id ok", nobody)).toBe("surel [email] ok");
    expect(maskText("bukan surel a@b", nobody)).toBe("bukan surel a@b");
  });

  test("a text with nothing personal is unchanged", () => {
    expect(maskText("air setinggi lutut di 3 rumah", reporter)).toBe("air setinggi lutut di 3 rumah");
  });
});
