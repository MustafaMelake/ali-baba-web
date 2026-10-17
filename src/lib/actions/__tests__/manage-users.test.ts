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

import { updateUserRole } from "@/lib/actions/manage-users";
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
