// ─────────────────────────────────────────────────────────────────────────────
// Admin image upload route (src/app/api/upload/route.ts).
//
// Pins the single uploader gate and the file rules:
//   • AUTH — no session → 401; a MANAGER, a customer, or an ADMIN held to
//     change a temporary password → 403; none of them reach storage.
//   • FILE — the leading bytes decide: a non-image is refused whatever its
//     claimed type, and the object is stored with the SNIFFED type; an unknown
//     folder → 400; over UPLOAD_MAX_BYTES → 413 (also when only declared).
//   • SUCCESS — a valid admin image → 200 { success: true, url }.
//   • FAILURE — storage errors become JSON envelopes, never a throw.
//
// MOCKING — @/lib/session (the session read) and putImage; the real
// validators (folder allowlist, sniffing, limits) and R2ConfigError run.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2")>()),
  putImage: vi.fn(),
}));

import { POST } from "@/app/api/upload/route";
import { getServerSession } from "@/lib/session";
import { putImage, R2ConfigError } from "@/lib/r2";
import { UPLOAD_MAX_BYTES } from "@/lib/validators";

const mockedSession = vi.mocked(getServerSession);
const mockedPut = vi.mocked(putImage);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
afterAll(() => consoleError.mockRestore());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);

function signedInAs(role: "ADMIN" | "MANAGER" | "USER" | null, mustChangePassword = false) {
  mockedSession.mockResolvedValue(
    role ? ({ user: { id: "u1", role, mustChangePassword } } as never) : null,
  );
}

function upload(file: Blob | string | null, folder: string | null = "products", headers?: HeadersInit) {
  const form = new FormData();
  if (folder !== null) form.append("folder", folder);
  if (file !== null) form.append("file", file);
  return POST(new Request("http://localhost/api/upload", { method: "POST", body: form, headers }));
}

async function body(res: Response) {
  return (await res.json()) as { success: boolean; url?: string; error?: string };
}

beforeEach(() => {
  mockedSession.mockReset();
  mockedPut.mockReset();
  mockedPut.mockResolvedValue("https://img.alibaba.test/products/abc.png");
  consoleError.mockClear();
});

describe("POST /api/upload — the uploader gate", () => {
  it("401s without a session", async () => {
    signedInAs(null);
    const res = await upload(new Blob([PNG], { type: "image/png" }));
    expect(res.status).toBe(401);
    expect(await body(res)).toMatchObject({ success: false });
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it.each(["MANAGER", "USER"] as const)("403s a %s", async (role) => {
    signedInAs(role);
    const res = await upload(new Blob([PNG], { type: "image/png" }));
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ success: false, error: "Only administrators can upload images." });
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("403s an ADMIN who must change a temporary password", async () => {
    signedInAs("ADMIN", true);
    const res = await upload(new Blob([PNG], { type: "image/png" }));
    expect(res.status).toBe(403);
    expect(mockedPut).not.toHaveBeenCalled();
  });
});

describe("POST /api/upload — the file", () => {
  beforeEach(() => signedInAs("ADMIN"));

  it("stores a valid admin image and answers its URL", async () => {
    const res = await upload(new Blob([PNG], { type: "image/png" }), "hero");

    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ success: true, url: "https://img.alibaba.test/products/abc.png" });
    expect(mockedPut).toHaveBeenCalledWith("hero", PNG, "image/png");
  });

  it("stores the SNIFFED type, not the claimed one", async () => {
    await upload(new Blob([JPEG], { type: "image/png" }));
    expect(mockedPut).toHaveBeenCalledWith("products", JPEG, "image/jpeg");
  });

  it.each([
    ["a text file", new Blob(["hello"], { type: "text/plain" })],
    ["a non-image claiming to be a PNG", new Blob(["<script>alert(1)</script>"], { type: "image/png" })],
    ["an SVG", new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: "image/svg+xml" })],
  ])("refuses %s", async (_label, file) => {
    const res = await upload(file);
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ success: false, error: "Upload a JPEG, PNG, WebP, AVIF or GIF image." });
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("refuses a file over the 4 MB cap with 413", async () => {
    const big = new Uint8Array(UPLOAD_MAX_BYTES + 1);
    big.set(PNG);
    const res = await upload(new Blob([big], { type: "image/png" }));
    expect(res.status).toBe(413);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("refuses an oversized declared body before reading it", async () => {
    const res = await upload(new Blob([PNG], { type: "image/png" }), "products", {
      "content-length": String(9 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown folder", "avatars"],
    ["a traversal folder", "../products"],
    ["no folder", null],
  ])("refuses %s", async (_label, folder) => {
    const res = await upload(new Blob([PNG], { type: "image/png" }), folder);
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ success: false, error: "Unknown image kind." });
  });

  it("refuses a missing or empty file", async () => {
    expect((await upload(null)).status).toBe(400);
    expect((await upload(new Blob([], { type: "image/png" }))).status).toBe(400);
    expect((await upload("not a file")).status).toBe(400);
  });
});

describe("POST /api/upload — storage failures", () => {
  beforeEach(() => signedInAs("ADMIN"));

  it("explains a missing R2 configuration", async () => {
    mockedPut.mockRejectedValue(new R2ConfigError("R2_BUCKET"));
    const res = await upload(new Blob([PNG], { type: "image/png" }));
    expect(res.status).toBe(500);
    expect((await body(res)).error).toMatch(/isn't configured/);
    expect(consoleError).toHaveBeenCalled();
  });

  it("turns any other storage error into a generic envelope", async () => {
    mockedPut.mockRejectedValue(new Error("SlowDown"));
    const res = await upload(new Blob([PNG], { type: "image/png" }));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ success: false, error: "The upload failed — please try again." });
  });
});
