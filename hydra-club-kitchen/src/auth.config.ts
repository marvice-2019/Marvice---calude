import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/auth/roles";

/**
 * Edge-safe Auth.js config (no DB, no argon2) shared by middleware and the
 * full server config. Middleware is only the first gate; every admin page and
 * API handler re-checks the user against Postgres via src/auth/guard.ts.
 */
export const authConfig = {
  trustHost: true, // behind Coolify's Traefik proxy
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // one working shift
  pages: { signIn: "/admin/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id!;
        token.role = user.role;
        token.mcp = user.mustChangePassword;
        // Our own sign-in time. Unlike `iat` it never moves when the cookie is re-issued,
        // so a password change can invalidate every older session. Milliseconds, not seconds.
        token.authAt = Date.now();
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid;
      session.user.role = token.role;
      session.user.mustChangePassword = token.mcp;
      session.authAt = token.authAt;
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isApi = pathname.startsWith("/api/admin");
      if (pathname === "/admin/login") return true;
      if (!auth?.user?.id) {
        return isApi ? Response.json({ error: "unauthorised" }, { status: 401 }) : false; // false = redirect to sign-in
      }
      if (auth.user.mustChangePassword && pathname !== "/admin/change-password") {
        return isApi
          ? Response.json({ error: "password_change_required" }, { status: 403 })
          : Response.redirect(new URL("/admin/change-password", request.nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;

declare module "next-auth" {
  interface User {
    role: Role;
    mustChangePassword: boolean;
  }
  interface Session {
    authAt: number;
    user: { id: string; role: Role; mustChangePassword: boolean; email: string; name: string };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    role: Role;
    mcp: boolean;
    authAt: number;
  }
}
