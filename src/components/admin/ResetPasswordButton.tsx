"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, KeyRound, Loader2, MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import { resetUserPassword } from "@/lib/actions/manage-users";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type Revealed = { tempPassword: string; whatsappHref: string | null };

/**
 * Users console → "Reset password" for one customer (ADMIN only; never shown
 * on the admin's own row — the server refuses that too). Confirm-in-place,
 * then a one-time dialog shows the temporary password with a copy button and
 * a WhatsApp chat link to the customer's last order phone. Closing the dialog
 * drops the password from memory — it is never shown again.
 */
export default function ResetPasswordButton({ userId, userName }: { userId: string; userName: string }) {
  const [confirming, setConfirming] = useState(false);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useDialogFocus<HTMLDivElement>(revealed !== null);

  function handleReset() {
    startTransition(async () => {
      const result = await resetUserPassword(userId);
      setConfirming(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setRevealed({ tempPassword: result.tempPassword, whatsappHref: result.whatsappHref });
      toast.success(`Password reset — ${userName} has been signed out everywhere`);
    });
  }

  function close() {
    setRevealed(null);
    setCopied(false);
  }

  async function copy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.tempPassword);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy — select the password and copy it manually.");
    }
  }

  // Escape closes the one-time dialog.
  useEffect(() => {
    if (!revealed) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [revealed]);

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        {confirming ? (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.18 }}
            className="inline-flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800"
          >
            <span>Reset &amp; sign out?</span>
            <button
              type="button"
              onClick={handleReset}
              disabled={isPending}
              aria-label={`Confirm password reset for ${userName}`}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-600 text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              aria-label="Cancel password reset"
              className="flex h-5 w-5 items-center justify-center rounded-full text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-60"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="trigger"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-stone-900"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Reset password
          </motion.button>
        )}
      </AnimatePresence>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {revealed && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
                  onClick={close}
                />
                <motion.div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="temp-password-title"
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.98 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 text-start shadow-2xl"
                >
                  <h3 id="temp-password-title" className="font-serif text-xl font-medium text-stone-900">
                    Temporary password for {userName}
                  </h3>
                  <p className="mt-2 text-sm text-stone-500">
                    Send it on WhatsApp now — it won&apos;t be shown again. They&apos;ll be asked to
                    choose a new password when they sign in.
                  </p>

                  <div className="mt-5 flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <code dir="ltr" className="flex-1 select-all font-mono text-lg tracking-wider text-stone-900">
                      {revealed.tempPassword}
                    </code>
                    <button
                      type="button"
                      onClick={copy}
                      autoFocus
                      className="inline-flex items-center gap-1.5 rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-stone-700"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                    {revealed.whatsappHref ? (
                      <a
                        href={revealed.whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-800"
                      >
                        <MessageCircle className="h-4 w-4" />
                        Open WhatsApp chat
                      </a>
                    ) : (
                      <span className="me-auto text-xs text-stone-400">No phone on file — reply in the WhatsApp chat they opened.</span>
                    )}
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50"
                    >
                      Done
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
