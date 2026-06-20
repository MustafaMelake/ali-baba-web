import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      // The `role` column lives on our Prisma User model but isn't part of
      // Better Auth's built-in schema. Declaring it here makes Better Auth
      // select it and include `user.role` in every session payload.
      //
      // `input: false` means clients can NOT set their own role during
      // sign-up — new users always fall back to the DB default (USER).
      // Promote admins by updating the row directly in the database.
      role: {
        type: "string",
        input: false,
        defaultValue: "USER",
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
  },
  // nextCookies must be the last plugin so it can set cookies on responses
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
