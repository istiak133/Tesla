import type { NextFunction, Request, Response } from 'express';

/**
 * Refuses a request body that is not JSON (415), before any body parser runs.
 *
 * An HTML form on another site can POST urlencoded, multipart or text bodies with no CORS
 * preflight, so without this a page could, for example, silently log a visitor in to the
 * attacker's account (login CSRF; the session cookie is SameSite=Lax, which does not stop a
 * top-level form POST from setting it). A cross-site request with a JSON body needs a
 * preflight, and CORS is off (the web app calls the API through its same-origin proxy), so
 * the browser never sends it.
 */
export function jsonBodiesOnly(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const length = request.headers['content-length'];
  const hasBody =
    request.headers['transfer-encoding'] !== undefined ||
    (length !== undefined && length !== '0');
  if (hasBody && request.is('application/json') === false) {
    response.status(415).json({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Send the request body as JSON',
    });
    return;
  }
  next();
}
