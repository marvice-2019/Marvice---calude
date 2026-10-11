import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { getPool } from "@/lib/data/pg-store";
import { rateLimiter, SIGN_IN_LIMITS } from "@/lib/rate-limit";
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
      ? { microsoft: { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenantId: "common", disableProfilePhoto: true } }
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

/** Networks our own reverse proxy runs on. Default: the private ranges Docker and Coolify use. Override with TRUSTED_PROXIES. */
export function trustedProxies(env: Record<string, string | undefined> = process.env): string[] {
  const list = env.TRUSTED_PROXIES ?? "127.0.0.1/32,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";
  return list.split(",").map((s) => s.trim()).filter(Boolean);
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
          before: async (user) => {
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
