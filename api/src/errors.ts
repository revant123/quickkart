import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** Throw this anywhere in a route to send a specific HTTP status + error code. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

/**
 * Central error handler. Express 5 forwards errors thrown in async routes here
 * automatically, so routes don't need try/catch just to report errors.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'validation_failed', details: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.code, details: err.details });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }
  console.error(err); // unexpected: log the real error, hide details from the client
  res.status(500).json({ error: 'internal_error' });
};
