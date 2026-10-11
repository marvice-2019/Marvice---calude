import { randomBytes } from "node:crypto";
import { InvalidOneOffError, type OneOffInput } from "./types";

export const MAX_ONE_OFF_TIMES = 20;

/** The rules both stores apply to a new one-off meeting. Returns its times earliest first. */
export function checkOneOff(input: OneOffInput, now: Date): Date[] {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 100) throw new InvalidOneOffError("name", "Enter a name (up to 100 characters).");
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 720) {
    throw new InvalidOneOffError("durationMinutes", "Duration must be 5 to 720 minutes.");
  }
  const times = input.times;
  if (times.length < 1 || times.length > MAX_ONE_OFF_TIMES) throw new InvalidOneOffError("times", `Offer 1 to ${MAX_ONE_OFF_TIMES} times.`);
  if (times.some((t) => Number.isNaN(t.getTime()) || t.getTime() <= now.getTime())) throw new InvalidOneOffError("times", "Every time must be in the future.");
  if (new Set(times.map((t) => t.getTime())).size !== times.length) throw new InvalidOneOffError("times", "Each time can be offered once.");
  return [...times].sort((a, b) => a.getTime() - b.getTime());
}

/** `one-off-` and 8 random lowercase letters or digits. */
export function oneOffSlug(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return `one-off-${Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join("")}`;
}
