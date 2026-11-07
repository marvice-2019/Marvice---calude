/**
 * Normalise an Indian mobile number typed any common way (98765 43210,
 * +91-98765-43210, 098765 43210) to E.164 (+919876543210). Returns null if it
 * is not a 10-digit Indian mobile (must start 6-9).
 */
export function toIndianE164(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}
