import { createHash, randomBytes } from "node:crypto";

/** A single-use link token: 32 random bytes, base64url. Shown to the host once; only its hash is stored. */
export function newLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What booking_links.token_hash holds: the token's SHA-256, hex. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
