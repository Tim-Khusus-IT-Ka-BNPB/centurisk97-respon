import { describe, expect, test } from "vitest";
import { s3PhotoStore } from "./store";

// The store against a real S3: Garage in CI (S3_TEST_* set by the workflow). Skipped where no S3
// is running, as on a laptop without Garage; store.test.ts covers the same calls in memory there.
const endpoint = process.env.S3_TEST_ENDPOINT;

describe.skipIf(endpoint === undefined)("files over Garage", () => {
  // Made per test: a skipped describe still runs its body, where no endpoint is set.
  const garage = () =>
    s3PhotoStore({
      endpoint: endpoint as string,
      region: process.env.S3_TEST_REGION ?? "garage",
      bucket: process.env.S3_TEST_BUCKET ?? "respon-files",
      accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? "",
    });
  const bytes = (size: number, fill: number) => new Uint8Array(size).fill(fill);

  test("a file is kept, read whole and in part, and removed", async () => {
    const store = garage();
    const key = `contract/${crypto.randomUUID()}.jpg`;
    await store.put(key, bytes(10, 7));
    expect(await store.get(key)).toEqual(bytes(10, 7));
    expect(await store.range(key, 4, 3)).toEqual({ bytes: bytes(3, 7), size: 10 });
    await store.delete([key]);
    expect(await store.get(key)).toBeNull();
    expect(await store.range(key, 0, 1)).toBeNull();
  });

  test("a video sent in parts is whole once completed; one given up leaves nothing", async () => {
    const store = garage();
    const key = `contract/${crypto.randomUUID()}.mp4`;
    const id = await store.startUpload(key, "video/mp4");
    // Every part but the last is at least 5 MiB, as S3 requires.
    const first = await store.uploadPart(key, id, 1, bytes(5 * 1024 * 1024, 1));
    const second = await store.uploadPart(key, id, 2, bytes(10, 2));
    await store.completeUpload(key, id, [
      { partNumber: 1, etag: first },
      { partNumber: 2, etag: second },
    ]);
    const whole = await store.range(key, 5 * 1024 * 1024 - 1, 2);
    expect(whole).toEqual({ bytes: new Uint8Array([1, 2]), size: 5 * 1024 * 1024 + 10 });
    const dropped = await store.startUpload(`${key}.dropped`, "video/mp4");
    await store.abortUpload(`${key}.dropped`, dropped);
    await store.delete([key]);
  });
});
