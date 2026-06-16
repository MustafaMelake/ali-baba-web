import "better-auth";

declare module "better-auth" {
  interface User {
    role: "ADMIN" | "USER";
  }
  interface Session {
    user: User;
  }
}
