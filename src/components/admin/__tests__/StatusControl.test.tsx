// @vitest-environment jsdom
// ─────────────────────────────────────────────────────────────────────────────
// StatusControl (the order drawer's status chips) — final statuses ask first.
//
// DELIVERED and CANCELLED are final (src/lib/order-status.ts), so choosing one
// opens an inline "This is final and can't be undone" confirmation; nothing is
// sent until staff confirm. Non-final steps still apply on one click.
// Boundary mocks: the server action, the router, sonner, framer-motion (static).
// ─────────────────────────────────────────────────────────────────────────────

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/orders", () => ({ updateOrderStatus: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const MOTION_PROPS = new Set(["initial", "animate", "exit", "transition", "layoutId"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !MOTION_PROPS.has(key)));
  const motion = new Proxy({}, {
    get: (_t, tag: string) => (props: Record<string, unknown>) => React.createElement(tag, strip(props)),
  });
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});

import { StatusControl } from "@/components/admin/AdminOrderDetailDrawer";
import { updateOrderStatus } from "@/lib/actions/orders";
import { FulfillmentMethod, OrderStatus } from "@/generated/prisma/enums";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedUpdate = vi.mocked(updateOrderStatus);
let container: HTMLDivElement;
let root: Root;

function render(current: OrderStatus, fulfillment: FulfillmentMethod = FulfillmentMethod.DELIVERY) {
  act(() => {
    root.render(<StatusControl orderId="o1" current={current} fulfillment={fulfillment} changedLabel={null} />);
  });
}

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const confirmPanel = () => container.querySelector('[role="alertdialog"]');

beforeEach(() => {
  mockedUpdate.mockReset();
  mockedUpdate.mockResolvedValue({ success: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("StatusControl — final statuses need confirmation", () => {
  it.each([
    [OrderStatus.SHIPPED, "Delivered"],
    [OrderStatus.PENDING, "Cancelled"],
  ])("from %s, choosing %s opens the confirmation and sends nothing yet", (current, label) => {
    render(current);

    act(() => button(label).click());

    const panel = confirmPanel();
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain(`Mark this order ${label}?`);
    expect(panel!.textContent).toContain("This is final and can't be undone.");
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("'Keep current status' closes it without changing anything", () => {
    render(OrderStatus.SHIPPED);
    act(() => button("Delivered").click());

    act(() => button("Keep current status").click());

    expect(confirmPanel()).toBeNull();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("'Yes, mark Delivered' sends the change", async () => {
    render(OrderStatus.SHIPPED);
    act(() => button("Delivered").click());

    await act(async () => button("Yes, mark Delivered").click());

    expect(mockedUpdate).toHaveBeenCalledWith("o1", OrderStatus.DELIVERED);
    expect(confirmPanel()).toBeNull();
  });

  it("a PICKUP being collected (PREPARING → DELIVERED) asks too", () => {
    render(OrderStatus.PREPARING, FulfillmentMethod.PICKUP);
    act(() => button("Delivered").click());
    expect(confirmPanel()).not.toBeNull();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("a non-final step (PENDING → PREPARING) still applies on one click, no confirmation", async () => {
    render(OrderStatus.PENDING);

    await act(async () => button("Preparing").click());

    expect(confirmPanel()).toBeNull();
    expect(mockedUpdate).toHaveBeenCalledWith("o1", OrderStatus.PREPARING);
  });

  it("final statuses that aren't a next step stay disabled — nothing to confirm", () => {
    render(OrderStatus.PENDING); // DELIVERY: Delivered isn't reachable from Pending
    expect(button("Delivered").disabled).toBe(true);
  });
});
