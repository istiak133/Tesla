import type { Request } from 'express';

/**
 * The address the login and sign-up rate limit counts by.
 *
 * Counting proxy hops (`trust proxy`) is not stable in production: the chain
 * browser → Vercel → Render's edge → the API has a changing number of hops and
 * changing proxy addresses, so each request looked like a new client and the limit
 * never filled up. The first X-Forwarded-For entry is the original client as seen by
 * the first proxy; Vercel overwrites that header, so it cannot be faked through the
 * web app. (A direct call to the API could fake it; the fix for that is a gateway
 * rate limit, noted in the README.)
 */
export function clientIp(request: Pick<Request, 'headers' | 'ip'>): string {
  const header = request.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header[0] : header;
  const first = value?.split(',')[0]?.trim();
  return first || request.ip || 'unknown';
}
