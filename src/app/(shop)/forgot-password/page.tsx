import type { Metadata } from "next";
import { getStoreContact } from "@/lib/store-settings";
import ForgotPasswordClient from "./ForgotPasswordClient";

// Shared ISR cache (60s): identical for every visitor — it reads only the
// store's WhatsApp number, never the visitor's account. `updateStoreWhatsapp`
// revalidates this path, so a change shows on the next request.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Forgot Password | Ali Baba",
  description: "Reset your Ali Baba account password with the store on WhatsApp.",
  robots: { index: false },
};

/**
 * There is no email provider: a customer who forgot their password messages
 * the store on WhatsApp, and an admin resets it from the users console
 * (resetUserPassword → a temporary password, then a forced change).
 *
 * Deliberately NO account lookup here — the page never says whether an email
 * or phone has an account, so it can't be used to enumerate customers.
 */
export default async function ForgotPasswordPage() {
  const { whatsappNumber } = await getStoreContact();
  return <ForgotPasswordClient storeWhatsapp={whatsappNumber} />;
}
