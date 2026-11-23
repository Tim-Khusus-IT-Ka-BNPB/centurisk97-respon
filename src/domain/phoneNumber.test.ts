import { describe, expect, test } from "vitest";
import { maskNumber, normaliseNumber, readBackNumber } from "./phoneNumber";

describe("typed WhatsApp number", () => {
  test("08, 62 and +62 forms store the same number", () => {
    expect(normaliseNumber("080000000001")).toBe("+6280000000001");
    expect(normaliseNumber("6280000000001")).toBe("+6280000000001");
    expect(normaliseNumber("+6280000000001")).toBe("+6280000000001");
  });

  test("spaces, dots, hyphens and brackets are ignored", () => {
    expect(normaliseNumber(" 0800 0000 0001 ")).toBe("+6280000000001");
    expect(normaliseNumber(" +6280000000001")).toBe("+6280000000001");
    expect(normaliseNumber("(0800) 0000-0001")).toBe("+6280000000001");
    expect(normaliseNumber("+62 800.0000.0001")).toBe("+6280000000001");
  });

  test("9 and 13 digits after +62 pass, 8 and 14 are refused", () => {
    expect(normaliseNumber("0812345678")).toBe("+62812345678");
    expect(normaliseNumber("08123456789012")).toBe("+628123456789012");
    expect(normaliseNumber("081234567")).toBeNull();
    expect(normaliseNumber("081234567890123")).toBeNull();
  });

  test("a number must start with 8 after the prefix", () => {
    expect(normaliseNumber("0212345678")).toBeNull();
    expect(normaliseNumber("62212345678")).toBeNull();
    expect(normaliseNumber("021800000000")).toBeNull();
    expect(normaliseNumber("+62180000000001")).toBeNull();
  });

  test("no prefix, a wrong prefix or letters are refused", () => {
    expect(normaliseNumber("80000000001")).toBeNull();
    expect(normaliseNumber("1280000000001")).toBeNull();
    expect(normaliseNumber(" +080000000001")).toBeNull();
    expect(normaliseNumber("+080000000001")).toBeNull();
    expect(normaliseNumber("+6380000000001")).toBeNull();
    expect(normaliseNumber("08000000000l")).toBeNull();
    expect(normaliseNumber("0800+00000001")).toBeNull();
    expect(normaliseNumber("")).toBeNull();
    expect(normaliseNumber("   ")).toBeNull();
  });

  test("masked for the list of known numbers", () => {
    expect(maskNumber("+6280000000001")).toBe("0800****0001");
    expect(maskNumber("+62812345678")).toBe("0812****5678");
  });

  test("read back in groups before it is stored", () => {
    expect(readBackNumber("+6280000000001")).toBe("+62 800 0000 0001");
    expect(readBackNumber("+62812345678")).toBe("+62 812 3456 78");
  });
});
