import type { RequestHandler } from 'express';
import { HttpError } from './errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Content types a cross-site HTML form can send without a CORS preflight. */
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/**
 * Cross-site request forgery guard for cookie-authenticated requests.
 * Session cookies are SameSite=Lax already; this also rejects state-changing requests
 * from another origin and anything a plain HTML form could submit.
 */
export function sameOriginGuard(appOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== appOrigin) {
      throw new HttpError(403, 'forbidden', 'Cross-origin requests are not allowed.');
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (FORM_TYPES.includes(type)) {
      throw new HttpError(415, 'unsupported_media_type', 'Send JSON.');
    }
    next();
  };
}
