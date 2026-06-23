import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";

/**
 * Better Auth – browser client.
 *
 * baseURL is optional on the client (Better Auth infers it from
 * window.location.origin), but we honour NEXT_PUBLIC_APP_URL when it is
 * provided so the client also works in SSR / preview environments.
 *
 * `inferAdditionalFields<typeof auth>()` mirrors the server's custom user
 * fields (here: `role`) onto the client, so `session.user.role` is fully
 * typed from `useSession()` — no manual module augmentation needed.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
