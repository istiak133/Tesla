import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'tesla_session';

/**
 * httpOnly: JavaScript in the page cannot read the cookie.
 * sameSite lax: the browser does not send it on requests started by other sites.
 * secure: only sent over HTTPS (production); local development uses plain HTTP.
 */
export function sessionCookieOptions(
  isProduction: boolean,
  ttlHours: number,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: ttlHours * 60 * 60 * 1000,
  };
}
