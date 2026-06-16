import { createAuthClient } from "better-auth/react";

/**
 * Better Auth – browser client.
 *
 * baseURL is optional on the client (Better Auth infers it from
 * window.location.origin), but we honour NEXT_PUBLIC_APP_URL when it is
 * provided so the client also works in SSR / preview environments.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
