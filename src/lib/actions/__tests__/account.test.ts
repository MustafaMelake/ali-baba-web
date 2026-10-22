// ─────────────────────────────────────────────────────────────────────────────
// Account actions — changeTemporaryPassword (src/lib/actions/account.ts).
//
// The exit from an ADMIN password reset. Locks the two properties that make the
// mustChangePassword gate trustworthy:
//   • the password changes ONLY through Better Auth's own endpoint (it verifies
//     the current password, hashes, and re-issues this device's session);
//   • the flag clears ONLY after that succeeded — never without a real change.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { changePassword: vi.fn() } } }));

import { changeTemporaryPassword } from "@/lib/actions/account";
import { getServerSession } from "@/lib/session";
import { auth } from "@/lib/auth";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedSession = vi.mocked(getServerSession);
const mockedChangePassword = auth.api.changePassword as unknown as ReturnType<typeof vi.fn>;
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const input = {
  currentPassword: "Tm4k-Qp3r-Tz9w-Hb7c",
  newPassword: "my-own-strong-password",
  confirmPassword: "my-own-strong-password",
};

/** A Better Auth APIError, as thrown by auth.api.* (body.code is the contract). */
const baError = (code: string) => Object.assign(new Error(code), { body: { code, message: code } });

beforeEach(() => {
  mockReset(mockPrisma);
  mockedChangePassword.mockReset();
  mockedSession.mockResolvedValue({ user: { id: "u1", role: "USER", mustChangePassword: true } } as never);
  mockedChangePassword.mockResolvedValue({ token: "new" });
  mockPrisma.user.update.mockResolvedValue({ id: "u1" } as never);
  consoleError.mockClear();
});

afterAll(() => consoleError.mockRestore());

describe("changeTemporaryPassword", () => {
  it("requires a session", async () => {
    mockedSession.mockResolvedValue(null as never);
    expect(await changeTemporaryPassword(input)).toEqual({ success: false, error: "Please sign in again." });
    expect(mockedChangePassword).not.toHaveBeenCalled();
  });

  it("re-parses the shared schema (mismatched confirmation) before touching auth", async () => {
    const res = await changeTemporaryPassword({ ...input, confirmPassword: "different-password" });
    expect(res).toEqual({ success: false, error: "The passwords don't match." });
    expect(mockedChangePassword).not.toHaveBeenCalled();
  });

  it("refuses reusing the temporary password", async () => {
    const res = await changeTemporaryPassword({
      ...input,
      newPassword: input.currentPassword,
      confirmPassword: input.currentPassword,
    });
    expect(res.success).toBe(false);
    expect(mockedChangePassword).not.toHaveBeenCalled();
  });

  it("changes the password through Better Auth, revoking other sessions, THEN clears the flag", async () => {
    expect(await changeTemporaryPassword(input)).toEqual({ success: true });

    expect(mockedChangePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers: expect.any(Headers),
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { mustChangePassword: false },
      select: { id: true },
    });
    expect(mockedChangePassword.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.user.update.mock.invocationCallOrder[0],
    );
  });

  it("a wrong current password leaves the flag set", async () => {
    mockedChangePassword.mockRejectedValue(baError("INVALID_PASSWORD"));
    expect(await changeTemporaryPassword(input)).toEqual({
      success: false,
      error: "Your current password is incorrect.",
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("an unexpected auth failure leaves the flag set and logs without leaking", async () => {
    mockedChangePassword.mockRejectedValue(new Error("db down"));
    expect(await changeTemporaryPassword(input)).toEqual({
      success: false,
      error: "Could not change your password. Please try again.",
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
