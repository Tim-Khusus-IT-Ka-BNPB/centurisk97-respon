import { afterEach, describe, expect, test, vi } from "vitest";
import { followed, toggleFollow } from "./follow";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("events followed on this device", () => {
  test("followed with the status seen, and let go", () => {
    expect(followed()).toEqual({});
    expect(toggleFollow("a", "in_handling")).toEqual({ a: "in_handling" });
    expect(toggleFollow("b", "closed")).toEqual({ a: "in_handling", b: "closed" });
    expect(toggleFollow("a", "closed")).toEqual({ b: "closed" });
    expect(followed()).toEqual({ b: "closed" });
  });

  test("storage that cannot be read or written follows nothing and breaks nothing", () => {
    for (const stored of ["{not json", "[1]", "null"]) {
      localStorage.setItem("respon-followed", stored);
      expect(followed()).toEqual({});
    }
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(toggleFollow("a", "closed")).toEqual({ a: "closed" });
  });
});
