import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { authenticate } from "@/auth/core";
import { getDb } from "@/db";
import { clientIp } from "@/lib/rate-limit";

export class RateLimitedSignin extends CredentialsSignin {
  override code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  logger: {
    // A wrong password is normal traffic, already recorded in audit_log; don't dump a stack trace for it.
    error(error) {
      if (error.name === "CredentialsSignin" || error instanceof CredentialsSignin) return;
      console.error(error);
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const result = await authenticate(getDb(), credentials, clientIp(request.headers));
        if (result.ok) return result.user;
        if (result.reason === "rate_limited") throw new RateLimitedSignin();
        return null;
      },
    }),
  ],
});
