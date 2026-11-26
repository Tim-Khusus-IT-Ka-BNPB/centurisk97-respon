import { afterEach, describe, expect, test, vi } from "vitest";
import { dropUpload, keepUpload, openUpload, sameFile } from "./videoResume";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const file = (size: number, modified: number) => new File([new Uint8Array(size)], "x.mp4", { lastModified: modified });

describe("an upload a reload cut off", () => {
  test("is kept per draft, without the file's name, and dropped when done", () => {
    expect(openUpload("d1")).toBeNull();
    keepUpload("d1", { id: "u1", size: 4, modified: 9 });
    keepUpload("d2", { id: "u2", size: 5, modified: 9 });
    expect(openUpload("d1")).toEqual({ id: "u1", size: 4, modified: 9 });
    expect(localStorage.getItem("lapor-video")).not.toContain("x.mp4");
    dropUpload("d1");
    expect(openUpload("d1")).toBeNull();
    expect(openUpload("d2")).toMatchObject({ id: "u2" });
    dropUpload("d2");
    expect(localStorage.getItem("lapor-video")).toBeNull();
  });

  test("knows its file again by size and modified time", () => {
    const upload = { id: "u1", size: 4, modified: 9 };
    expect(sameFile(upload, file(4, 9))).toBe(true);
    expect(sameFile(upload, file(5, 9))).toBe(false);
    expect(sameFile(upload, file(4, 8))).toBe(false);
  });

  test("storage that holds nothing readable, or refuses, starts over", () => {
    localStorage.setItem("lapor-video", "[1]");
    expect(openUpload("d1")).toBeNull();
    localStorage.setItem("lapor-video", "{broken");
    expect(openUpload("d1")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => keepUpload("d1", { id: "u1", size: 4, modified: 9 })).not.toThrow();
  });
});
