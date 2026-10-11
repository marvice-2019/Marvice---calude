import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { getPool } from "@/lib/data/pg-store";
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
    advanced: { database: { generateId: false } }, // Postgres fills uuid ids
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
    },
    socialProviders: googleEnabled()
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID as string, clientSecret: process.env.GOOGLE_CLIENT_SECRET as string } }
      : {},
    plugins: [
      magicLink({ expiresIn: 15 * 60, storeToken: "hashed", sendMagicLink: async ({ email, url }) => deliverMagicLink(email, url) }),
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
