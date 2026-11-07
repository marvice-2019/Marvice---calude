import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// argon2id with the OWASP baseline (19 MiB, 2 passes, 1 lane). Algorithm 2 = Argon2id.
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use at most 128 characters.");

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false; // malformed hash: treat as a mismatch, never as a crash
  }
}

/** Verified against when the email is unknown, so a miss costs the same time as a wrong password. */
let dummyHash: Promise<string> | undefined;
export function burnVerifyTime(plain: string): Promise<boolean> {
  dummyHash ??= hashPassword("timing-equaliser-not-a-real-password");
  return dummyHash.then((h) => verifyPassword(h, plain));
}
