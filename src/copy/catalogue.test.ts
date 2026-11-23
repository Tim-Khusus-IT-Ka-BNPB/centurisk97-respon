import { describe, expect, test } from "vitest";
import { bannedWordHits, CopyError, copy, createCatalogue } from "./index";

const fixture = createCatalogue({
  "./id/a.json": {
    "card.sent.ticket": "Nomor tiket: {ticketNumber}",
    "limit.x": "Paling banyak {limit} pesan, {who}.",
  },
  "./id/b.json": { "state.none": "tidak ada" },
});

describe("copy catalogue", () => {
  test("keys from every file, sorted", () => {
    expect(fixture.keys).toEqual(["card.sent.ticket", "limit.x", "state.none"]);
    expect(fixture.has("state.none")).toBe(true);
    expect(fixture.has("state.unknown")).toBe(false);
    expect(fixture.text("state.none")).toBe("tidak ada");
  });

  test("params fill placeholders, numbers with the thousands dot", () => {
    expect(fixture.format("card.sent.ticket", { ticketNumber: "LA-231126-01" })).toBe("Nomor tiket: LA-231126-01");
    expect(fixture.format("limit.x", { limit: 2000, who: "nomor ini" })).toBe("Paling banyak 2.000 pesan, nomor ini.");
    expect(fixture.format("state.none")).toBe("tidak ada");
  });

  test("a missing key or param fails loudly", () => {
    expect(() => fixture.text("state.unknown")).toThrow(new CopyError("Copy key state.unknown is missing"));
    expect(() => fixture.format("card.sent.ticket")).toThrow(
      new CopyError("Copy key card.sent.ticket needs param ticketNumber"),
    );
  });

  test("broken files are refused", () => {
    expect(() => createCatalogue({ "./id/a.json": { k: "x" }, "./id/b.json": { k: "y" } })).toThrow(
      "Copy key k is defined twice",
    );
    expect(() => createCatalogue({ "./id/a.json": { k: 3 } })).toThrow("Copy key k in ./id/a.json is not text");
    for (const content of [null, "text", ["k"]]) {
      expect(() => createCatalogue({ "./id/a.json": content })).toThrow("Copy file ./id/a.json is not one flat object");
    }
  });
});

describe("the banned safety word", () => {
  test("found as a whole word in any case, not inside other words", () => {
    const catalogue = createCatalogue({
      "./id/x.json": {
        a: "Daerah ini aman.",
        b: "AMAN untuk dilewati",
        c: "halaman, tanaman, keamanan, amanah, aman2",
        d: "Tanaman puso atau gagal panen",
      },
    });
    expect(bannedWordHits(catalogue)).toEqual(["a", "b"]);
  });

  test("the real catalogue never uses it", () => {
    expect(bannedWordHits(copy)).toEqual([]);
  });

  test("the real catalogue loads every file", () => {
    expect(copy.keys.length).toBeGreaterThan(0);
  });
});
