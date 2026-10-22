// ─────────────────────────────────────────────────────────────────────────────
// Role & branch assignment — updateUserRole (src/lib/actions/manage-users.ts).
//
// The schema can't express "MANAGER ⇒ has a branchId", so this action is the
// assignment chokepoint (requireDashboardAccess is the access one):
//   • ADMIN-only, answered with an envelope rather than a throw;
//   • a MANAGER must be linked to a branch that exists;
//   • USER / ADMIN never keep a branch, whatever the form sent;
//   • an admin can't strip their own admin role (self-lockout).
//
// MOCKING — same strategy as promotions.test.ts: @/lib/prisma deep-mocked,
// @/lib/session and next/cache stubbed, the real action-utils gate runs.
// ─────────────────────────────────────────────────────────────────────────────

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: mockDeep<PrismaClient>() }));
vi.mock("@/lib/session", () => ({ getServerSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Better Auth's own password + session machinery, as resetUserPassword uses it.
const authCtx = vi.hoisted(() => ({
  password: { hash: vi.fn(async (pw: string) => `hashed(${pw})`) },
  internalAdapter: { updatePassword: vi.fn(), deleteUserSessions: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ auth: { $context: Promise.resolve(authCtx) } }));

import { resetUserPassword, updateUserRole } from "@/lib/actions/manage-users";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { UserRole } from "@/generated/prisma/enums";

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>;
const mockedRequireAdmin = vi.mocked(requireAdmin);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const ADMIN_ID = "admin_1";
const TARGET_ID = "user_42";

beforeEach(() => {
  mockReset(mockPrisma);
  vi.mocked(revalidatePath).mockReset();
  mockedRequireAdmin.mockReset();
  mockedRequireAdmin.mockResolvedValue({ user: { id: ADMIN_ID, role: "ADMIN" } } as never);
  mockPrisma.branch.findUnique.mockResolvedValue({ id: "branch_maadi" } as never);
  mockPrisma.user.update.mockResolvedValue({ id: TARGET_ID } as never);
  consoleError.mockClear();
});

afterAll(() => {
  consoleError.mockRestore();
});

describe("updateUserRole — who may call it", () => {
  it("answers a non-admin with an error envelope and writes nothing", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("Unauthorized: admin access required."));

    const result = await updateUserRole({ userId: TARGET_ID, role: UserRole.ADMIN });

    expect(result).toEqual({ success: false, error: "Unauthorized: admin access required." });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it.each([UserRole.USER, UserRole.MANAGER])(
    "won't let an admin demote themselves to %s",
    async (role) => {
      const result = await updateUserRole({ userId: ADMIN_ID, role, branchId: "branch_maadi" });

      expect(result).toEqual({ success: false, error: "You can't change your own admin role." });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    },
  );

  it("rejects a role that isn't one of the enum's", async () => {
    const result = await updateUserRole({ userId: TARGET_ID, role: "OWNER" as UserRole });

    expect(result).toEqual({ success: false, error: "Invalid role." });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("updateUserRole — MANAGER ⇒ branch", () => {
  it("requires a branch for a manager", async () => {
    const result = await updateUserRole({ userId: TARGET_ID, role: UserRole.MANAGER, branchId: null });

    expect(result).toEqual({
      success: false,
      error: "Select a branch — a manager must be assigned to one.",
    });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses a branch that no longer exists", async () => {
    mockPrisma.branch.findUnique.mockResolvedValue(null);

    const result = await updateUserRole({ userId: TARGET_ID, role: UserRole.MANAGER, branchId: "branch_gone" });

    expect(result).toEqual({ success: false, error: "That branch no longer exists." });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("links a manager to the branch and refreshes the users list and dashboard", async () => {
    const result = await updateUserRole({ userId: TARGET_ID, role: UserRole.MANAGER, branchId: "branch_maadi" });

    expect(result).toEqual({ success: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TARGET_ID },
        data: { role: UserRole.MANAGER, branchId: "branch_maadi" },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it.each([UserRole.USER, UserRole.ADMIN])(
    "clears the branch when the user becomes %s, whatever the form sent",
    async (role) => {
      await updateUserRole({ userId: TARGET_ID, role, branchId: "branch_maadi" });

      expect(mockPrisma.branch.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role, branchId: null } }),
      );
    },
  );
});

describe("updateUserRole — database outcomes", () => {
  it("translates a vanished user (P2025)", async () => {
    mockPrisma.user.update.mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }));

    const result = await updateUserRole({ userId: TARGET_ID, role: UserRole.USER });

    expect(result).toEqual({ success: false, error: "That user no longer exists." });
  });

  it("answers anything else generically and logs it", async () => {
    mockPrisma.user.update.mockRejectedValue(new Error("connection reset"));

    const result = await updateUserRole({ userId: TARGET_ID, role: UserRole.USER });

    expect(result).toEqual({ success: false, error: "Could not update the user. Please try again." });
    expect(consoleError).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resetUserPassword — the admin half of the WhatsApp forgot-password flow
// ─────────────────────────────────────────────────────────────────────────────

describe("resetUserPassword", () => {
  const credentialUser = {
    id: TARGET_ID,
    accounts: [{ id: "acc_1" }],
    orders: [{ customerPhone: "+201001234567" }],
  };

  beforeEach(() => {
    authCtx.password.hash.mockClear();
    authCtx.internalAdapter.updatePassword.mockReset();
    authCtx.internalAdapter.deleteUserSessions.mockReset();
    mockPrisma.user.findUnique.mockResolvedValue(credentialUser as never);
  });

  it("is ADMIN-only — a rejected caller touches nothing", async () => {
    mockedRequireAdmin.mockRejectedValue(new Error("Unauthorized: admin access required."));
    const res = await resetUserPassword(TARGET_ID);
    expect(res).toEqual({ success: false, error: "Unauthorized: admin access required." });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(authCtx.internalAdapter.updatePassword).not.toHaveBeenCalled();
  });

  it("refuses the admin's own account", async () => {
    const res = await resetUserPassword(ADMIN_ID);
    expect(res.success).toBe(false);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(authCtx.internalAdapter.updatePassword).not.toHaveBeenCalled();
  });

  it("refuses an account with no password sign-in", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...credentialUser, accounts: [] } as never);
    const res = await resetUserPassword(TARGET_ID);
    expect(res.success).toBe(false);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("reports a user that no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as never);
    expect(await resetUserPassword(TARGET_ID)).toEqual({
      success: false,
      error: "That user no longer exists.",
    });
  });

  it("flags first, hashes through Better Auth, then revokes every session", async () => {
    const res = await resetUserPassword(TARGET_ID);
    expect(res.success).toBe(true);
    if (!res.success) return;

    // A strong, readable temporary password: 4 × 4 from the no-look-alike set.
    expect(res.tempPassword).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{4}(-[A-HJ-NP-Za-km-np-z2-9]{4}){3}$/);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: TARGET_ID },
      data: { mustChangePassword: true },
      select: { id: true },
    });
    expect(authCtx.password.hash).toHaveBeenCalledWith(res.tempPassword);
    expect(authCtx.internalAdapter.updatePassword).toHaveBeenCalledWith(
      TARGET_ID,
      `hashed(${res.tempPassword})`,
    );
    expect(authCtx.internalAdapter.deleteUserSessions).toHaveBeenCalledWith(TARGET_ID);

    // Ordering: the flag is set before the password changes.
    expect(mockPrisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      authCtx.internalAdapter.updatePassword.mock.invocationCallOrder[0],
    );
  });

  it("links the customer's WhatsApp without putting the password in the URL", async () => {
    const res = await resetUserPassword(TARGET_ID);
    if (!res.success) throw new Error("expected success");
    expect(res.whatsappHref).toBe("https://wa.me/201001234567");
    expect(res.whatsappHref).not.toContain(res.tempPassword);
  });

  it("returns a null WhatsApp link when the user has never ordered", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...credentialUser, orders: [] } as never);
    const res = await resetUserPassword(TARGET_ID);
    expect(res.success && res.whatsappHref).toBeNull();
  });

  it("mints a different password every time", async () => {
    const a = await resetUserPassword(TARGET_ID);
    const b = await resetUserPassword(TARGET_ID);
    expect(a.success && b.success && a.tempPassword !== b.tempPassword).toBe(true);
  });

  it("never logs the temporary password when a later step fails", async () => {
    authCtx.internalAdapter.deleteUserSessions.mockRejectedValue(new Error("db down"));
    const res = await resetUserPassword(TARGET_ID);
    expect(res).toEqual({ success: false, error: "Could not reset the password. Please try again." });
    const hashed = authCtx.password.hash.mock.calls[0]?.[0] as string;
    const logged = JSON.stringify(consoleError.mock.calls.map((c) => c.map(String)));
    expect(logged).not.toContain(hashed);
  });
});
