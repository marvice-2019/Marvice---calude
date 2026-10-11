import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts small secrets (OAuth tokens) before they are stored, with AES-256-GCM. A stolen database dump or backup
// is useless without TOKEN_ENCRYPTION_KEY, which lives only in the server's environment.
// Layout: 1 version byte, 12-byte IV, 16-byte auth tag, ciphertext.

const VERSION = 1;

/** TOKEN_ENCRYPTION_KEY as 64 hex characters or 32 bytes of base64 (`openssl rand -hex 32`). */
export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set (generate one with: openssl rand -hex 32)");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes: 64 hex characters or 44 base64 characters");
  return key;
}

export function seal(key: Buffer, value: unknown, aad = ""): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

/**
 * Decrypts what seal() produced. `aad` binds the ciphertext to its owner (for example the connection id), so a value
 * copied from one row into another fails to open. Throws on any tampering or a wrong key.
 */
export function unseal<T>(key: Buffer, sealed: Buffer, aad = ""): T {
  if (sealed.length < 29 || sealed[0] !== VERSION) throw new Error("Unknown sealed value format");
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(1, 13));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(13, 29));
  const plain = Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as T;
}

let cached: Buffer | undefined;
export function tokenKey(): Buffer {
  return (cached ??= parseKey(process.env.TOKEN_ENCRYPTION_KEY));
}
