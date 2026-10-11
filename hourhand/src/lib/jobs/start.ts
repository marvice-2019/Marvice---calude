import { resolveBaseUrl } from "../auth/auth";
import { calendarConfigError, calendarDeps } from "../calendar/env";
import { getPool } from "../data/pg-store";
import { createMailer } from "../mail/mailer";
import { startJobRunner, type JobRunner } from "./runner";

const shared = globalThis as typeof globalThis & { __hourhandJobs?: JobRunner };

/** Starts the job runner once per server process, from the environment. Throws when email or the URL isn't configured. */
export function startJobsFromEnv(env: Record<string, string | undefined> = process.env): void {
  if (shared.__hourhandJobs) return;
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for the job runner");
  const mailer = createMailer(env);
  const baseUrl = (resolveBaseUrl(env) ?? "http://localhost:3000").replace(/\/+$/, "");
  // Google Calendar is optional; when it's configured, a missing or bad TOKEN_ENCRYPTION_KEY stops the server here.
  const configError = calendarConfigError(env);
  if (configError) throw new Error(configError);
  const calendar = calendarDeps(env);
  shared.__hourhandJobs = startJobRunner({ pool: getPool(env.DATABASE_URL), mailer, baseUrl, calendar });
  console.info(`[jobs] runner started (${env.RESEND_API_KEY ? "Resend" : "log only"}, Google Calendar ${calendar ? "on" : "off"})`);
}
