import { describe, expect, test } from "vitest";
import { findNumbers } from "./numbers";

const numbers = (text: string) => [...findNumbers(text)].sort((a, b) => a - b);

describe("numbers stated in a text", () => {
  test("ported vectors: written words and digits", () => {
    expect(numbers("dua belas orang mengungsi")).toEqual([12]);
    expect(numbers("seratus lima rumah")).toEqual([105]);
    expect(numbers("1.250 jiwa")).toEqual([1250]);
    expect(numbers("tiga rusak berat")).toEqual([3]);
  });

  test("every unit word", () => {
    const words = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];
    words.forEach((word, value) => {
      expect(numbers(`${word} rumah`)).toEqual([value]);
    });
    expect(numbers("sepuluh")).toEqual([10]);
    expect(numbers("sebelas")).toEqual([11]);
    expect(numbers("seratus")).toEqual([100]);
    expect(numbers("seribu")).toEqual([1000]);
  });

  test("tens, hundreds and thousands compose", () => {
    expect(numbers("dua puluh lima")).toEqual([25]);
    expect(numbers("tiga ratus")).toEqual([300]);
    expect(numbers("dua ribu lima ratus")).toEqual([2500]);
    expect(numbers("sepuluh ribu")).toEqual([10_000]);
    expect(numbers("seribu dua")).toEqual([1002]);
    expect(numbers("lima belas")).toEqual([15]);
    expect(numbers("dua, belas")).toEqual([12]);
  });

  test("tens after hundreds and hundreds after thousands add, never multiply what came before", () => {
    expect(numbers("seratus lima puluh orang")).toEqual([150]);
    expect(numbers("dua ratus tiga puluh empat")).toEqual([234]);
    expect(numbers("seribu lima ratus")).toEqual([1500]);
    expect(numbers("seratus dua belas")).toEqual([112]);
    expect(numbers("tiga ribu dua ratus lima puluh enam")).toEqual([3256]);
    expect(numbers("seratus sebelas")).toEqual([111]);
    expect(numbers("dua puluh ribu")).toEqual([20_000]);
    expect(numbers("dua puluh belas")).toEqual([20]);
    expect(numbers("dua puluh ratus tiga")).toEqual([3, 20]);
  });

  test("a number word right after digits multiplies them", () => {
    expect(numbers("3 ribu warga")).toEqual([3000]);
    expect(numbers("2 ratus rumah")).toEqual([200]);
    expect(numbers("4 puluh orang")).toEqual([40]);
    expect(numbers("1,5 ribu jiwa")).toEqual([1500]);
    expect(numbers("12 ribu warga")).toEqual([12_000]);
    expect(numbers("sekitar 3 ribu warga")).toEqual([3000]);
    expect(numbers("1,25 ribu jiwa")).toEqual([1250]);
  });

  test("a multiplier or belas with no number before it is not a number", () => {
    expect(numbers("belas puluh ratus ribu")).toEqual([]);
    expect(numbers("ribuan orang")).toEqual([]);
  });

  test("separate numbers stay separate", () => {
    expect(numbers("dua rumah dan tiga orang")).toEqual([2, 3]);
    expect(numbers("4 rumah, 5 orang")).toEqual([4, 5]);
  });

  test("a comma or a dot not before three digits is a decimal", () => {
    expect(numbers("2,5 meter")).toEqual([2.5]);
    expect(numbers("1.5 meter")).toEqual([1.5]);
    expect(numbers("1.2500 meter")).toEqual([1.25]);
  });

  test("thousand groups join", () => {
    expect(numbers("12.345.678 orang")).toEqual([12_345_678]);
  });

  test("case, emphasis and spacing do not matter", () => {
    expect(numbers("  *TIGA*   rumah ")).toEqual([3]);
  });

  test("a text with no number holds none", () => {
    expect(numbers("tidak ada korban")).toEqual([]);
    expect(numbers("")).toEqual([]);
  });
});
