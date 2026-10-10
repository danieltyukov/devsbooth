import type { ErrorRequestHandler, RequestHandler } from 'express';
import { type z } from 'zod';
import type { ApiErrorBody, ApiErrorCode } from '@devsbooth/shared';
import { log } from '../log';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign in to continue.');
export const forbidden = (message = 'You are not allowed to do that.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new HttpError(404, 'not_found', message);

/** Validates `data` against `schema`, throwing a 400 with one message per invalid field. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, 'validation_failed', 'Some fields are not valid.', fields);
}

function body(code: ApiErrorCode, message: string, fields?: Record<string, string>): ApiErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json(body('not_found', 'No such endpoint.'));
};

interface BodyParserError {
  type?: string;
  status?: number;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json(body(err.code, err.message, err.fields));
    return;
  }
  const parserError = err as BodyParserError;
  if (parserError.type === 'entity.too.large') {
    res.status(413).json(body('payload_too_large', 'That upload is too large.'));
    return;
  }
  if (parserError.type === 'entity.parse.failed') {
    res.status(400).json(body('bad_request', 'The request body is not valid JSON.'));
    return;
  }
  // http-errors from Express middleware, such as serve-static's 404 for a missing file.
  const status = parserError.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res
      .status(status)
      .json(
        body(status === 404 ? 'not_found' : 'bad_request', status === 404 ? 'Not found.' : 'Bad request.'),
      );
    return;
  }
  log.error('Unhandled error', { method: req.method, path: req.path, err });
  res.status(500).json(body('internal', 'Something went wrong on our side.'));
};
