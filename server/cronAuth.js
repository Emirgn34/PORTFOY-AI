import { timingSafeEqual } from 'node:crypto';

export function validCronSecret(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
