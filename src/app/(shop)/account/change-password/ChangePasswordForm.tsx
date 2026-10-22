"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { changeTemporaryPassword } from "@/lib/actions/account";
import { useSession } from "@/lib/auth-client";
import { changePasswordSchema, fieldErrors, PASSWORD_MIN_LENGTH } from "@/lib/validators";

/** Page strings, kept out of the markup (the Arabic locale swaps this table). */
const COPY = {
  eyebrow: "Account",
  titleTemporary: "Choose a new password",
  title: "Change your password",
  introTemporary:
    "You signed in with a temporary password from the store. Pick your own to continue — you'll stay signed in on this device.",
  intro: "You'll stay signed in on this device; other devices are signed out.",
  current: (temporary: boolean) => (temporary ? "Temporary password" : "Current password"),
  next: "New password",
  confirm: "Confirm new password",
  hint: `At least ${PASSWORD_MIN_LENGTH} characters.`,
  submit: "Save password",
  saving: "Saving…",
  done: "Password changed",
} as const;

const inputClasses =
  "w-full border-b border-stone-300 bg-transparent pb-3 text-start font-sans text-base text-stone-900 caret-primary outline-none transition-colors duration-300 placeholder:text-stone-300 focus:border-primary";
const labelClasses =
  "mb-3 block font-sans text-[10px] font-semibold uppercase tracking-[0.25em] text-stone-400";

export default function ChangePasswordForm({
  temporary,
  isStaff,
}: {
  temporary: boolean;
  isStaff: boolean;
}) {
  const router = useRouter();
  const { refetch } = useSession();
  const [isPending, startTransition] = useTransition();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { currentPassword, newPassword, confirmPassword };
    // Same schema the action re-parses — instant feedback only.
    const parsed = changePasswordSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});

    startTransition(async () => {
      const result = await changeTemporaryPassword(payload);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(COPY.done);
      // The flag is cleared server-side; refresh the client session so the
      // PasswordChangeGate lets go before navigating on.
      await refetch();
      router.replace(isStaff ? "/admin" : "/");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center bg-[#FAFAFA] px-6 py-16">
      <form onSubmit={handleSubmit} noValidate className="w-full max-w-md">
        <p className="flex items-center gap-2 font-sans text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
          <KeyRound className="h-3.5 w-3.5" />
          {COPY.eyebrow}
        </p>
        <h1 className="mt-4 font-serif text-4xl font-medium tracking-tight text-stone-900 md:text-5xl">
          {temporary ? COPY.titleTemporary : COPY.title}
        </h1>
        <p className="mt-5 font-sans text-sm leading-relaxed text-stone-500">
          {temporary ? COPY.introTemporary : COPY.intro}
        </p>

        <div className="mt-9 space-y-8">
          {(
            [
              ["current-password", COPY.current(temporary), currentPassword, setCurrentPassword, "currentPassword", "current-password"],
              ["new-password", COPY.next, newPassword, setNewPassword, "newPassword", "new-password"],
              ["confirm-password", COPY.confirm, confirmPassword, setConfirmPassword, "confirmPassword", "new-password"],
            ] as const
          ).map(([id, label, value, setValue, field, autoComplete]) => (
            <div key={id}>
              <label htmlFor={id} className={labelClasses}>
                {label}
              </label>
              <input
                id={id}
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete={autoComplete}
                aria-invalid={!!errors[field]}
                aria-describedby={errors[field] ? `${id}-error` : undefined}
                className={inputClasses}
              />
              {errors[field] ? (
                <p id={`${id}-error`} role="alert" className="mt-2 font-sans text-xs text-red-500">
                  {errors[field]}
                </p>
              ) : (
                field === "newPassword" && (
                  <p className="mt-2 font-sans text-xs text-stone-400">{COPY.hint}</p>
                )
              )}
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="mt-10 flex w-full items-center justify-center gap-3 rounded-full bg-stone-900 px-8 py-4 font-sans text-sm font-semibold uppercase tracking-widest text-white transition-colors duration-300 hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? COPY.saving : COPY.submit}
        </button>
      </form>
    </div>
  );
}
