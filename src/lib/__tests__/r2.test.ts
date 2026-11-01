// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare R2 client (src/lib/r2.ts).
//
// Pins: the client is LAZY (importing never throws, using it without env
// throws R2ConfigError naming the missing variable); publicUrl ⇄ keyFromUrl
// round-trip, with keyFromUrl refusing anything off the public base (legacy
// UploadThing URLs, /public paths, look-alike hosts, traversal); object keys
// are "<folder>/<cuid>.<ext>" with the extension from the content type; and
// putImage sends one PutObject with the right bucket, key and Content-Type;
// deleteUploadedFiles deletes exactly the right keys (de-duped, non-R2 values
// skipped, ≤ 1000 per request) and never throws — the post-commit contract.
//
// MOCKING — @aws-sdk/client-s3: S3Client records its config and its sends.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const constructed: unknown[] = [];
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: unknown) {
      constructed.push(config);
    }
    send = send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  DeleteObjectsCommand: class {
    constructor(public input: unknown) {}
  },
}));

const ENV = {
  R2_ENDPOINT: "https://acct123.r2.cloudflarestorage.com",
  R2_ACCESS_KEY_ID: "test-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret",
  R2_BUCKET: "alibaba-images",
  NEXT_PUBLIC_R2_PUBLIC_BASE_URL: "https://img.alibaba.test",
};

async function loadR2() {
  vi.resetModules();
  return import("@/lib/r2");
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({});
  constructed.length = 0;
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lazy client", () => {
  it("imports without env and builds nothing until used", async () => {
    for (const k of Object.keys(ENV)) vi.stubEnv(k, "");
    const r2 = await loadR2();

    expect(constructed).toHaveLength(0);
    expect(() => r2.r2Client()).toThrow(r2.R2ConfigError);
    expect(() => r2.r2Client()).toThrow(/R2_ENDPOINT/);
  });

  it("builds one region-auto client on the R2 endpoint, reused after", async () => {
    const r2 = await loadR2();

    const a = r2.r2Client();
    const b = r2.r2Client();

    expect(a).toBe(b);
    expect(constructed).toEqual([
      {
        region: "auto",
        endpoint: ENV.R2_ENDPOINT,
        credentials: { accessKeyId: ENV.R2_ACCESS_KEY_ID, secretAccessKey: ENV.R2_SECRET_ACCESS_KEY },
      },
    ]);
  });
});

describe("publicUrl ⇄ keyFromUrl", () => {
  it("round-trips a key", async () => {
    const { publicUrl, keyFromUrl } = await loadR2();

    const url = publicUrl("products/abc123.webp");

    expect(url).toBe("https://img.alibaba.test/products/abc123.webp");
    expect(keyFromUrl(url)).toBe("products/abc123.webp");
  });

  it("round-trips under a base with a path prefix (and a trailing slash)", async () => {
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "https://cdn.alibaba.test/media/");
    const { publicUrl, keyFromUrl } = await loadR2();

    const url = publicUrl("hero/k1.png");

    expect(url).toBe("https://cdn.alibaba.test/media/hero/k1.png");
    expect(keyFromUrl(url)).toBe("hero/k1.png");
    expect(keyFromUrl("https://cdn.alibaba.test/hero/k1.png")).toBeNull(); // outside the prefix
  });

  it.each([
    "https://x8k2p9.ufs.sh/f/abc123", // legacy UploadThing
    "https://utfs.io/f/abc123",
    "/placeholder.jpg",
    "https://img.alibaba.test.evil.com/products/a.jpg",
    "http://img.alibaba.test/products/a.jpg",
    "https://img.alibaba.test/products/a.jpg?v=2",
    "https://img.alibaba.test/",
    "https://img.alibaba.test/products/../secrets.txt",
    "https://img.alibaba.test/products//a.jpg",
    "https://img.alibaba.test/secrets/a.jpg", // not an upload folder
    "https://img.alibaba.test/products/nested/a.jpg",
    "not a url",
    "",
  ])("returns null for %s", async (url) => {
    const { keyFromUrl } = await loadR2();
    expect(keyFromUrl(url)).toBeNull();
  });

  it("publicUrl throws R2ConfigError without a public base", async () => {
    vi.stubEnv("NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "");
    const { publicUrl, keyFromUrl, R2ConfigError } = await loadR2();

    expect(() => publicUrl("products/a.jpg")).toThrow(R2ConfigError);
    expect(keyFromUrl("https://img.alibaba.test/products/a.jpg")).toBeNull();
  });
});

describe("objectKey / putImage", () => {
  it("keys an object as <folder>/<cuid>.<ext from the content type>", async () => {
    const { objectKey } = await loadR2();

    expect(objectKey("products", "image/jpeg")).toMatch(/^products\/[a-z0-9]{20,}\.jpg$/);
    expect(objectKey("hero", "image/png")).toMatch(/^hero\/[a-z0-9]{20,}\.png$/);
    expect(objectKey("locations", "image/webp")).not.toBe(objectKey("locations", "image/webp"));
  });

  it("sends one PutObject to the bucket and returns the public URL", async () => {
    const { putImage, keyFromUrl } = await loadR2();
    const body = new Uint8Array([1, 2, 3]);

    const url = await putImage("categories", body, "image/webp");

    expect(send).toHaveBeenCalledTimes(1);
    const { input } = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(input).toMatchObject({ Bucket: ENV.R2_BUCKET, Body: body, ContentType: "image/webp" });
    expect(input.Key).toMatch(/^categories\/[a-z0-9]+\.webp$/);
    expect(keyFromUrl(url)).toBe(input.Key);
  });

  it("propagates a storage failure to the caller", async () => {
    send.mockRejectedValue(new Error("AccessDenied"));
    const { putImage } = await loadR2();

    await expect(putImage("products", new Uint8Array([1]), "image/png")).rejects.toThrow("AccessDenied");
  });
});

describe("deleteUploadedFiles", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  beforeEach(() => consoleError.mockClear());

  it("deletes the right keys, de-duped, skipping anything not on R2", async () => {
    const { deleteUploadedFiles } = await loadR2();

    await deleteUploadedFiles([
      "https://img.alibaba.test/products/a.webp",
      "https://img.alibaba.test/products/a.webp", // duplicate
      "https://img.alibaba.test/hero/b.png",
      "https://x8k2p9.ufs.sh/f/legacy", // legacy UploadThing — not ours to delete
      "/placeholder.jpg",
      null,
      undefined,
      "",
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    const { input } = send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(input).toEqual({
      Bucket: ENV.R2_BUCKET,
      Delete: { Objects: [{ Key: "products/a.webp" }, { Key: "hero/b.png" }], Quiet: true },
    });
  });

  it("makes no request when nothing is deletable", async () => {
    const { deleteUploadedFiles } = await loadR2();

    await deleteUploadedFiles(["/placeholder.jpg", "https://utfs.io/f/x", null]);

    expect(send).not.toHaveBeenCalled();
  });

  it("splits more than 1000 keys into batches", async () => {
    const { deleteUploadedFiles } = await loadR2();
    const urls = Array.from({ length: 1001 }, (_, i) => `https://img.alibaba.test/products/k${i}.jpg`);

    await deleteUploadedFiles(urls);

    expect(send).toHaveBeenCalledTimes(2);
    const sizes = send.mock.calls.map(([c]) => (c as { input: { Delete: { Objects: unknown[] } } }).input.Delete.Objects.length);
    expect(sizes).toEqual([1000, 1]);
  });

  it("only logs a failed purge — never throws", async () => {
    send.mockRejectedValue(new Error("NoSuchBucket"));
    const { deleteUploadedFiles } = await loadR2();

    await expect(deleteUploadedFiles(["https://img.alibaba.test/products/a.webp"])).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });

  it("logs per-key errors reported by R2", async () => {
    send.mockResolvedValue({ Errors: [{ Key: "products/a.webp", Code: "AccessDenied" }] });
    const { deleteUploadedFiles } = await loadR2();

    await deleteUploadedFiles(["https://img.alibaba.test/products/a.webp"]);

    expect(consoleError).toHaveBeenCalled();
  });

  it("swallows missing R2 env too", async () => {
    vi.stubEnv("R2_ENDPOINT", "");
    const { deleteUploadedFiles } = await loadR2();

    await expect(deleteUploadedFiles(["https://img.alibaba.test/products/a.webp"])).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});
