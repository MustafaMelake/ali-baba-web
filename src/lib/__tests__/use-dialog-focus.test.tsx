// @vitest-environment jsdom
//
// ─────────────────────────────────────────────────────────────────────────────
// useDialogFocus — keyboard focus for every modal dialog and drawer.
//
// `aria-modal` tells a screen reader the page behind is out of reach, but it
// doesn't stop Tab from walking into it. The hook keeps a keyboard user inside
// the open dialog and puts them back where they were when it closes:
//   • opening moves focus to the dialog's first control — unless an autoFocus
//     field already took it;
//   • Tab / Shift+Tab wrap inside the topmost open dialog;
//   • closing returns focus to the control that opened it, even when an
//     autoFocus field moved focus before the hook's effect ran.
//
// A real React tree renders into jsdom (no testing library), with real focus.
// jsdom has no `checkVisibility`; the stub treats anything inside [hidden] as
// invisible, which is what the browser API reports for display:none.
// ─────────────────────────────────────────────────────────────────────────────

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useDialogFocus } from "@/lib/use-dialog-focus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  HTMLElement.prototype.checkVisibility = function (this: HTMLElement) {
    return !this.closest("[hidden]");
  };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Dialog({ open, autoFocusField = false }: { open: boolean; autoFocusField?: boolean }) {
  const ref = useDialogFocus<HTMLDivElement>(open);
  return (
    <>
      <button id="trigger">Open</button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true">
          <button id="close">Close</button>
          <input id="field" autoFocus={autoFocusField} />
          <button id="hidden-action" hidden>
            Hidden
          </button>
          <button id="save">Save</button>
        </div>
      )}
      <button id="behind">Behind</button>
    </>
  );
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

/** Press Tab the way a browser would deliver it: keydown on the focused element. */
function pressTab(shift = false) {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

describe("useDialogFocus — opening", () => {
  it("moves focus to the dialog's first control", () => {
    render(<Dialog open={false} />);
    $("trigger").focus();

    render(<Dialog open />);

    expect(document.activeElement).toBe($("close"));
  });

  it("leaves focus on a field that autoFocus already chose", () => {
    render(<Dialog open={false} autoFocusField />);
    $("trigger").focus();

    render(<Dialog open autoFocusField />);

    expect(document.activeElement).toBe($("field"));
  });
});

describe("useDialogFocus — Tab stays inside", () => {
  it("wraps Tab from the last control to the first", () => {
    render(<Dialog open />);
    $("save").focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe($("close"));
  });

  it("wraps Shift+Tab from the first control to the last visible one", () => {
    render(<Dialog open />);
    $("close").focus();

    pressTab(true);

    expect(document.activeElement).toBe($("save")); // not the [hidden] button
  });

  it("leaves Tab between inner controls to the browser", () => {
    render(<Dialog open />);
    $("close").focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(false);
  });

  it("pulls focus back in when it has escaped to the page behind", () => {
    render(<Dialog open />);
    $("behind").focus();

    pressTab();

    expect(document.activeElement).toBe($("close"));
  });

  it("stops trapping once closed", () => {
    render(<Dialog open />);
    render(<Dialog open={false} />);
    $("behind").focus();

    const event = pressTab();

    expect(event.defaultPrevented).toBe(false);
  });
});

describe("useDialogFocus — closing", () => {
  it("returns focus to the control that opened it", () => {
    render(<Dialog open={false} />);
    $("trigger").focus();
    render(<Dialog open />);

    render(<Dialog open={false} />);

    expect(document.activeElement).toBe($("trigger"));
  });

  it("returns focus to the opener even when autoFocus moved focus before the hook ran", () => {
    render(<Dialog open={false} autoFocusField />);
    $("trigger").focus();
    render(<Dialog open autoFocusField />);

    render(<Dialog open={false} autoFocusField />);

    expect(document.activeElement).toBe($("trigger"));
  });

  it("doesn't restore a stale element after a pointer press focused nothing (Safari buttons)", () => {
    render(<Dialog open={false} autoFocusField />);
    $("behind").focus();
    $("behind").blur();
    // Safari: pressing a button doesn't focus it.
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    render(<Dialog open autoFocusField />);

    render(<Dialog open={false} autoFocusField />);

    expect(document.activeElement).not.toBe($("behind"));
  });
});
