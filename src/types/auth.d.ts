// Custom user fields (e.g. `role`) are now inferred end-to-end from the server
// `auth` config:
//   • Server: declared in `auth.user.additionalFields` (src/lib/auth.ts).
//   • Client: surfaced via `inferAdditionalFields<typeof auth>()` (auth-client.ts).
//
// Module augmentation is therefore no longer required to type `session.user.role`.
export {};
