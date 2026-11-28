import { describe, expect, test } from "vitest";
import { MEMORY_S3, memoryBucket } from "./memoryBucket";
import { s3PhotoStore } from "./store";

// The store's calls, against a bucket in memory that answers as S3 does. The same calls run
// against Garage itself in store.contract.test.ts.
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array | null | undefined) => (value ? new TextDecoder().decode(value) : null);

describe("files over S3", () => {
  test("a file is kept, read whole or in part, and removed; a missing one is null", async () => {
    const bucket = memoryBucket();
    const store = s3PhotoStore(MEMORY_S3, bucket.fetcher);
    await store.put("photos/a b/1.jpg", bytes("hello world"));
    expect(bucket.objects.has("photos/a b/1.jpg")).toBe(true);
    expect(text(await store.get("photos/a b/1.jpg"))).toBe("hello world");
    const part = await store.range("photos/a b/1.jpg", 6, 5);
    expect([text(part?.bytes), part?.size]).toEqual(["world", 11]);
    await store.delete(["photos/a b/1.jpg", "photos/never.jpg"]);
    await store.delete([]);
    expect(await store.get("photos/a b/1.jpg")).toBeNull();
    expect(await store.range("photos/a b/1.jpg", 0, 1)).toBeNull();
  });

  test("a file sent in parts is whole once completed, and given up leaves nothing", async () => {
    const bucket = memoryBucket();
    const store = s3PhotoStore(MEMORY_S3, bucket.fetcher);
    const id = await store.startUpload("videos/v.mp4", "video/mp4");
    const first = await store.uploadPart("videos/v.mp4", id, 1, bytes("ab"));
    const second = await store.uploadPart("videos/v.mp4", id, 2, bytes("cd"));
    await store.completeUpload("videos/v.mp4", id, [
      { partNumber: 1, etag: first },
      { partNumber: 2, etag: second },
    ]);
    expect(text(await store.get("videos/v.mp4"))).toBe("abcd");
    const dropped = await store.startUpload("videos/w.mp4", "video/mp4");
    await store.abortUpload("videos/w.mp4", dropped);
    await store.abortUpload("videos/w.mp4", dropped);
    expect(bucket.uploads.size).toBe(0);
  });

  test("a refusal names the call and its status, never the bucket's words", async () => {
    const bucket = memoryBucket();
    const store = s3PhotoStore({ ...MEMORY_S3, accessKeyId: "GKsomeoneelse" }, bucket.fetcher);
    await expect(store.put("k", bytes("x"))).rejects.toThrow("s3.put: 403");
    await expect(store.get("k")).rejects.toThrow("s3.get: 403");
    await expect(store.startUpload("k", "video/mp4")).rejects.toThrow("s3.startUpload: 403");
    await expect(store.abortUpload("k", "u")).rejects.toThrow("s3.abortUpload: 403");
    expect((await bucket.fetcher(`${MEMORY_S3.endpoint}/${MEMORY_S3.bucket}/k`)).status).toBe(403);
  });

  test("a part the bucket does not know, or an answer with no upload id, is refused", async () => {
    const bucket = memoryBucket();
    const store = s3PhotoStore(MEMORY_S3, bucket.fetcher);
    const id = await store.startUpload("videos/x.mp4", "video/mp4");
    await expect(store.completeUpload("videos/x.mp4", id, [{ partNumber: 1, etag: '"etag-1"' }])).rejects.toThrow(
      "s3.completeUpload: refused",
    );
    await expect(store.uploadPart("videos/x.mp4", "no-such-upload", 1, bytes("a"))).rejects.toThrow(
      "s3.uploadPart: 404",
    );
    const empty = s3PhotoStore(MEMORY_S3, async () => new Response("<Nothing/>"));
    await expect(empty.startUpload("k", "video/mp4")).rejects.toThrow("s3.startUpload: no upload id");
    const untagged = s3PhotoStore(MEMORY_S3, async () => new Response(null));
    expect(await untagged.uploadPart("k", "u", 1, bytes("a"))).toBe("");
    const unsized = s3PhotoStore(MEMORY_S3, async () => new Response("abc", { status: 206 }));
    expect(await unsized.range("k", 0, 3)).toEqual({ bytes: bytes("abc"), size: 3 });
    const elsewhere = s3PhotoStore({ ...MEMORY_S3, bucket: "another" }, bucket.fetcher);
    expect(await elsewhere.get("k")).toBeNull();
  });
});
