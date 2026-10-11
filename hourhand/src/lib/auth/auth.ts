import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { getPool } from "@/lib/data/pg-store";
import { rateLimiter, SIGN_IN_LIMITS, trustedProxies } from "@/lib/rate-limit";

export { trustedProxies };
import { deliverMagicLink } from "./outbox";
import { uniqueSlug } from "./slug";

/** Sign-in needs the database. In HOURHAND_DATA=memory (the default for local work) there is no auth instance. */
export function authEnabled(): boolean {
  return process.env.HOURHAND_DATA === "postgres";
}

/** Google sign-in only appears once both of its env vars are set. */
export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function microsoftEnabled(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

/** Microsoft's tenant id for personal accounts: there the email is the Microsoft sign-in itself, so Microsoft vouches for it. */
const MICROSOFT_PERSONAL_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/**
 * Whether Microsoft vouches for the email on a sign-in. Work and school tenants can set any address on a user, so their
 * email counts only with the email_verified claim or the xms_edov ("email domain owner verified") optional claim.
 */
export function microsoftEmailVerified(profile: { email_verified?: boolean; xms_edov?: boolean | string; tid?: string }): boolean {
  return profile.email_verified === true || profile.xms_edov === true || profile.xms_edov === "1" || profile.xms_edov === "true"
    || profile.tid === MICROSOFT_PERSONAL_TENANT;
}

/**
 * True when a new account must not be created: a Microsoft sign-in whose email Microsoft doesn't vouch for. Otherwise
 * someone could sign up as another person's address, attach their own calendar, and keep it there after the real owner
 * later proves the email with a sign-in link. `ctx` is Better Auth's endpoint context (the OAuth callback or idToken sign-in).
 */
export function refuseUnverifiedSignUp(user: { emailVerified?: boolean | null }, ctx: unknown): boolean {
  const c = (ctx ?? {}) as { params?: { id?: string }; path?: string; body?: { provider?: string } };
  const viaMicrosoft = c.params?.id === "microsoft" || (c.path === "/sign-in/social" && c.body?.provider === "microsoft");
  return viaMicrosoft && user.emailVerified !== true;
}

/**
 * Social sign-in providers from the environment. Microsoft is deliberately not a trusted provider for account linking:
 * Entra often doesn't vouch for the email, so a Microsoft account showing someone's address must not take over their
 * Hourhand account. An email that already has an account is refused and the host signs in with their email link.
 */
export function socialProvidersFromEnv(env: Record<string, string | undefined> = process.env) {
  return {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
    // tenant "common": work, school and personal Microsoft accounts. No profile photo: it would be stored inline in users.image.
    ...(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
      ? { microsoft: {
          clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenantId: "common", disableProfilePhoto: true,
          mapProfileToUser: (profile: Parameters<typeof microsoftEmailVerified>[0]) => ({ emailVerified: microsoftEmailVerified(profile) }),
        } }
      : {}),
  };
}

/**
 * The public base URL that sign-in links are built from. Production must set it: without it Better Auth
 * falls back to the request's Host header, and a forged Host would put a stranger's domain in a real sign-in email.
 */
export function resolveBaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const url = env.BETTER_AUTH_URL;
  if (!url && env.NODE_ENV === "production") throw new Error("BETTER_AUTH_URL must be set in production (the public https URL of the app)");
  return url;
}


function createAuth() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("HOURHAND_DATA=postgres needs DATABASE_URL to be set");
  const baseURL = resolveBaseUrl();
  const pool = getPool(url);
  const at = { createdAt: "created_at", updatedAt: "updated_at" };

  return betterAuth({
    database: pool,
    baseURL,
    trustedOrigins: baseURL ? [baseURL] : [],
    // Better Auth's own limiter guards its HTTP endpoints; the sign-in page's server action adds per-email limits itself.
    rateLimit: {
      enabled: process.env.NODE_ENV === "production",
      window: 60,
      max: 100,
      customRules: { "/sign-in/magic-link": { window: 600, max: 5 }, "/sign-in/social": { window: 60, max: 10 } },
    },
    advanced: {
      database: { generateId: false }, // Postgres fills uuid ids
      // Rate limits key on the client address. Only proxy hops on these networks are skipped when reading
      // x-forwarded-for, so a visitor can't forge their address or push everyone into one shared bucket.
      ipAddress: { trustedProxies: trustedProxies() },
    },
    user: {
      modelName: "users",
      fields: { emailVerified: "email_verified", ...at },
      additionalFields: { slug: { type: "string", required: false, input: false } },
    },
    session: {
      modelName: "auth_sessions",
      fields: { userId: "user_id", expiresAt: "expires_at", ipAddress: "ip_address", userAgent: "user_agent", ...at },
    },
    account: {
      // Sign-in tokens are sealed at rest; rows written before this stay readable (Better Auth passes plain values through).
      encryptOAuthTokens: true,
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        ...at,
      },
    },
    verification: { modelName: "auth_verification_tokens", fields: { expiresAt: "expires_at", ...at } },
    databaseHooks: {
      user: {
        create: {
          // Every host needs a booking-link slug; users.slug is not null.
          before: async (user, ctx) => {
            if (refuseUnverifiedSignUp(user, ctx)) return false;
            const slug = await uniqueSlug(user.email, user.name, async (candidate) => {
              const { rowCount } = await pool.query("select 1 from users where slug = $1", [candidate]);
              return (rowCount ?? 0) > 0;
            });
            return { data: { ...user, slug } };
          },
        },
      },
      session: {
        create: {
          // A closed account keeps its row for 30 days before the purge; it must not be able to sign back in.
          before: async (session) => {
            const { rows } = await pool.query("select deleted_at from users where id = $1", [session.userId]);
            return rows[0] && rows[0].deleted_at === null ? { data: session } : false;
          },
        },
      },
    },
    socialProviders: socialProvidersFromEnv(),
    plugins: [
      magicLink({ expiresIn: 15 * 60, storeToken: "hashed", sendMagicLink: async ({ email, url }) => {
          // Both the sign-in page and direct calls to /api/auth reach here, so the per-email limit lives here.
          if (!rateLimiter.take(`email:${email.toLowerCase()}`, SIGN_IN_LIMITS.perEmail)) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in links for this email" });
          }
          await deliverMagicLink(email, url);
        },
      }),
      nextCookies(), // must stay last
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const shared = globalThis as typeof globalThis & { __hourhandAuth?: Auth };

/** The one Better Auth instance for this server process. Throws in memory mode. */
export function getAuth(): Auth {
  if (!authEnabled()) throw new Error("Sign-in needs HOURHAND_DATA=postgres");
  return (shared.__hourhandAuth ??= createAuth());
}
