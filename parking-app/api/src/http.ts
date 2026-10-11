import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, "invalid_request", first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request");
  }
  return r.data;
}

export const Phone10 = z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.");
export const Plate = z.string().transform(s => s.replace(/[\s-]/g, "").toUpperCase())
  .refine(s => /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(s), "Enter a valid number plate, for example KA 01 AB 1234 or 22 BH 1234 AB.");
export const Uuid = z.string().uuid();
export const IsoDate = z.string().datetime({ offset: true }).transform(s => new Date(s));

export function rupees(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

export function idemKey(req: FastifyRequest): string {
  const k = req.headers["idempotency-key"];
  if (typeof k !== "string" || k.length < 8 || k.length > 100) throw new HttpError(400, "idempotency_key_required", "Send an Idempotency-Key header (8–100 characters) with this request.");
  return k;
}

export function send(reply: FastifyReply, status: number, body: unknown) { return reply.code(status).send(body); }
