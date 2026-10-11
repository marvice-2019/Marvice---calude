import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { HttpError } from "./http.js";
import type { Notifier, OtpSender, Payments } from "./providers.js";
import { authRoutes } from "./auth.js";
import { publicRoutes } from "./routes/public.js";
import { bookingRoutes } from "./routes/bookings.js";
import { meRoutes } from "./routes/me.js";
import { monthlyRoutes } from "./routes/monthly.js";
import { opsRoutes } from "./routes/ops.js";
import { adminRoutes } from "./routes/admin.js";

export type Deps = { cfg: Config; db: Db; payments: Payments; otp: OtpSender; notify: Notifier };

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: deps.cfg.NODE_ENV === "production" ? "info" : "debug",
      redact: ["req.headers.authorization", "req.headers['x-internal-token']"] },
    trustProxy: true,
    bodyLimit: 64 * 1024
  });

  await app.register(cors, { origin: [deps.cfg.WEB_ORIGIN], credentials: false });
  await app.register(jwt, { secret: deps.cfg.JWT_SECRET });
  await app.register(rateLimit, { global: true, max: deps.cfg.RATE_LIMIT_MAX, timeWindow: "1 minute" });

  // Keep the raw body for webhook signature checks; parse JSON ourselves.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as any).rawBody = body;
    if (!body) return done(null, undefined);
    try { done(null, JSON.parse(body as string)); } catch { done(new HttpError(400, "invalid_json", "Request body is not valid JSON."), undefined); }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: "rate_limited", message: "Too many requests. Slow down and try again shortly." });
    if (status && status < 500) return reply.code(status).send({ error: "bad_request", message: (err as Error).message });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "internal", message: "Something went wrong on our side. Try again in a minute." });
  });

  app.get("/health", async () => {
    await deps.db.query("SELECT 1");
    return { ok: true };
  });

  authRoutes(app, deps);
  publicRoutes(app, deps);
  bookingRoutes(app, deps);
  meRoutes(app, deps);
  monthlyRoutes(app, deps);
  opsRoutes(app, deps);
  adminRoutes(app, deps);
  return app;
}
