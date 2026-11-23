import { describe, expect, test } from "vitest";
import { formatTicketNumber, isTicketNumber, ticketDay } from "./ticketNumber";

describe("ticket number", () => {
  test("LA, the WIB date as DDMMYY and the day's sequence", () => {
    expect(formatTicketNumber("2026-11-23", 1)).toBe("LA-231126-01");
    expect(formatTicketNumber("2026-01-05", 7)).toBe("LA-050126-07");
  });

  test("the sequence grows past two digits", () => {
    expect(formatTicketNumber("2026-11-23", 99)).toBe("LA-231126-99");
    expect(formatTicketNumber("2026-11-23", 100)).toBe("LA-231126-100");
  });

  test("a sequence below 1 or not whole is refused", () => {
    expect(() => formatTicketNumber("2026-11-23", 0)).toThrow(new RangeError("A ticket sequence starts at 1"));
    expect(() => formatTicketNumber("2026-11-23", 1.5)).toThrow(RangeError);
  });

  test("the day counts in WIB", () => {
    expect(ticketDay(Date.UTC(2026, 10, 23, 16, 59))).toBe("2026-11-23");
    expect(ticketDay(Date.UTC(2026, 10, 23, 17, 0))).toBe("2026-11-24");
  });

  test("format check", () => {
    expect(isTicketNumber("LA-231126-01")).toBe(true);
    expect(isTicketNumber("LA-231126-100")).toBe(true);
    expect(isTicketNumber("LA-231126-1")).toBe(false);
    expect(isTicketNumber("LA-231126-00")).toBe(false);
    expect(isTicketNumber("LA-23112-01")).toBe(false);
    expect(isTicketNumber("XLA-231126-01")).toBe(false);
    expect(isTicketNumber("LA-231126-01x")).toBe(false);
  });
});
