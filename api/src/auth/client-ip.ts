import type { Request } from 'express';

/**
 * The address the login and sign-up rate limit counts by.
 *
 * Counting proxy hops (`trust proxy`) is not stable in production: the chain
 * browser → Vercel → Render's edge → the API has a changing number of hops and
 * changing proxy addresses, so each request looked like a new client and the limit
 * never filled up. The first X-Forwarded-For entry is the original client as seen by
 * the first proxy; Vercel overwrites that header, so it cannot be faked through the
 * web app. A direct call to the API, or a self-hosted proxy that passes the header
 * through, can fake it: that is why login is also limited per account (`accountKey`).
 */
export function clientIp(request: Pick<Request, 'headers' | 'ip'>): string {
  const header = request.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header[0] : header;
  const first = value?.split(',')[0]?.trim();
  return first || request.ip || 'unknown';
}

/**
 * The second login limit counts by the account being tried, whatever address it comes
 * from: a faked X-Forwarded-For on every request gets around the per-address limit, but
 * not this one. Without an email in the body it falls back to the address.
 */
export function accountKey(
  request: Pick<Request, 'headers' | 'ip'> & { body?: unknown },
): string {
  const body = request.body as { email?: unknown } | undefined;
  const email =
    typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return email === '' ? `ip:${clientIp(request)}` : `account:${email}`;
}
