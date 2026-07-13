"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Loader2, Check, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { createFaq, updateFaq } from "@/lib/actions/faqs";
import { cn } from "@/lib/utils";

const inputClasses =
  "w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-primary focus:ring-2 focus:ring-primary/20";

// Mirror the server-side `validateFaq` bounds so the counters (and the disabled
// submit) fail fast before a round-trip. The server re-checks these regardless —
// this is display-only, never the source of truth.
const QUESTION_MAX = 200;
const ANSWER_MAX = 2000;

export type EditableFaq = {
  id: string;
  question: string;
  answer: string;
  isActive: boolean;
};

/**
 * One controlled modal for BOTH create and edit, mirroring FooterLinkModal. Pass
 * a `faq` to edit it; omit it to create. On success it closes and calls
 * `router.refresh()` so the Server Component list re-reads the (already
 * revalidated) data instantly. The Active toggle only shows when editing —
 * `createFaq` takes no `isActive` and the row defaults to active.
 */
export default function FaqModal({
  faq,
  isOpen,
  onClose,
}: {
  faq?: EditableFaq;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEdit = Boolean(faq);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Sync the form to the row each time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: prime the form on open */
    setQuestion(faq?.question ?? "");
    setAnswer(faq?.answer ?? "");
    setIsActive(faq?.isActive ?? true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isOpen, faq]);

  // Esc to close + lock background scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, isPending, onClose]);

  const trimmedQuestion = question.trim();
  const trimmedAnswer = answer.trim();
  const canSubmit =
    trimmedQuestion.length >= 2 &&
    trimmedQuestion.length <= QUESTION_MAX &&
    trimmedAnswer.length >= 2 &&
    trimmedAnswer.length <= ANSWER_MAX;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      const result =
        isEdit && faq
          ? await updateFaq(faq.id, {
              question: trimmedQuestion,
              answer: trimmedAnswer,
              isActive,
            })
          : await createFaq({
              question: trimmedQuestion,
              answer: trimmedAnswer,
            });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? "FAQ updated" : "FAQ added");
      onClose();
      router.refresh();
    });
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => !isPending && onClose()}
            className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={isEdit ? "Edit FAQ" : "Add FAQ"}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-stone-100 px-6 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <HelpCircle className="h-4.5 w-4.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                      {isEdit ? "Edit FAQ" : "New FAQ"}
                    </p>
                    <h3 className="font-serif text-xl font-medium text-stone-900">
                      {isEdit ? "Edit this question" : "Add a question"}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => !isPending && onClose()}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="faq-question" className="text-sm font-medium text-stone-700">
                      Question
                    </label>
                    <span className="text-[11px] tabular-nums text-stone-400">
                      {trimmedQuestion.length}/{QUESTION_MAX}
                    </span>
                  </div>
                  <input
                    id="faq-question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Do you offer custom cake designs?"
                    className={inputClasses}
                    maxLength={QUESTION_MAX}
                    autoFocus
                  />
                  <p className="text-xs text-stone-400">
                    Shown as the accordion header on the storefront FAQ section.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="faq-answer" className="text-sm font-medium text-stone-700">
                      Answer
                    </label>
                    <span className="text-[11px] tabular-nums text-stone-400">
                      {trimmedAnswer.length}/{ANSWER_MAX}
                    </span>
                  </div>
                  <textarea
                    id="faq-answer"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Yes — our Cairo branches take custom orders with 48 hours' notice…"
                    rows={5}
                    className={cn(inputClasses, "min-h-32 resize-y leading-relaxed")}
                    maxLength={ANSWER_MAX}
                  />
                  <p className="text-xs text-stone-400">
                    The answer body revealed when a customer expands the question.
                  </p>
                </div>

                {isEdit && (
                  <div className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-stone-700">Active</p>
                      <p className="text-xs text-stone-400">
                        Inactive FAQs are hidden from the storefront.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      aria-label="Toggle active"
                      onClick={() => setIsActive((v) => !v)}
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                        isActive ? "bg-primary" : "bg-stone-300",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                          isActive ? "translate-x-5" : "translate-x-0.5",
                        )}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 border-t border-stone-100 px-6 py-4">
                <button
                  type="button"
                  onClick={() => onClose()}
                  disabled={isPending}
                  className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !canSubmit}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isEdit ? "Saving…" : "Adding…"}
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      {isEdit ? "Save Changes" : "Add FAQ"}
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
