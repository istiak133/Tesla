import { createHash, randomBytes } from 'node:crypto';

/**
 * A new random session token. This raw value goes into the cookie only.
 * 32 random bytes cannot be guessed.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only this hash is stored in the database, so a leaked database
 * does not give anyone a working session.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
