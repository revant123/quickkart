/** Error thrown for any non-2xx API response. `code` is the API's error code, e.g. 'out_of_stock'. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

/**
 * The ONE place the app talks to the backend.
 * - Paths are relative ('/stores'); Vite forwards /api to the Express server.
 * - credentials: 'include' sends the httpOnly session cookie.
 * - Non-2xx responses become ApiError, so every screen handles errors the same way.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
      credentials: 'include',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error'); // server down or no internet
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'unknown_error', data.details);
  return data as T;
}

/** Uploads a file as multipart form data (the browser sets the Content-Type boundary itself). */
export async function uploadFile<T>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData();
  form.append(field, file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'unknown_error', data.details);
  return data as T;
}

/** Turns an error into one plain sentence for the user. */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Try again.';
  const messages: Record<string, string> = {
    network_error: "Can't reach QuickKart. Check that the API is running, then try again.",
    invalid_credentials: 'That email and password don’t match an account.',
    email_taken: 'An account with this email already exists. Log in instead.',
    validation_failed: 'Some details are missing or not valid. Check the form and try again.',
    out_of_stock: 'One of the items in your cart just sold out.',
    slot_unavailable: 'That delivery slot just filled up. Pick another one.',
    cannot_cancel: 'This order can no longer be cancelled.',
    illegal_transition: 'This order can’t move to that status from where it is now.',
    stock_would_go_negative: 'That would take stock below zero.',
    slot_exists: 'This store already has a slot starting at that time.',
    slot_in_past: 'Pick a start time in the future.',
    forbidden: 'You need an admin account for this.',
    image_too_large: 'That photo is over 1 MB. Use a smaller one.',
    unsupported_image_type: 'Use a JPEG, PNG or WebP photo.',
    rate_limited: 'Too many attempts. Wait a few minutes and try again.',
    unauthenticated: 'Log in to continue.',
    internal_error: 'The server hit a problem. Try again in a moment.',
  };
  return messages[err.code] ?? `Request failed (${err.code}).`;
}
