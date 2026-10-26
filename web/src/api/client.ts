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
    pincode_unknown: 'We don’t know that pincode yet. We deliver in Chandigarh, Mohali and Panchkula.',
    outside_delivery_area: 'This store doesn’t deliver to that address. Pick another address or a nearer store.',
    address_not_found: 'That address no longer exists. Pick another one.',
    too_many_addresses: 'You can save up to 10 addresses. Delete one first.',
    email_not_verified: 'Confirm your email address before placing an order. Check your inbox.',
    already_verified: 'Your email is already confirmed.',
    invalid_or_expired_token: 'This link has expired or was already used. Ask for a new one.',
    not_awaiting_payment: 'This order isn’t waiting for a payment any more.',
    payment_expired: 'The time to pay ran out, so the order was cancelled. Place it again.',
    invalid_payment_signature: 'The payment couldn’t be confirmed. If money left your account, it will be refunded.',
    payment_not_started: 'Start the payment again.',
    payment_declined: 'The payment was declined. Try again or choose cash on delivery.',
    payment_gateway_unreachable: 'The payment service isn’t responding. Try again in a minute.',
    payment_gateway_error: 'The payment service refused the request. Try again in a minute.',
    already_taken: 'Another rider picked this order up first.',
    not_ready: 'This order isn’t packed yet.',
    not_out_for_delivery: 'This order isn’t out for delivery.',
    user_not_found: 'No account with that email. They need to register first.',
    cannot_change_admin: 'Admins can’t be made riders.',
    rider_has_deliveries: 'This rider still has orders on the way. Wait until they’re delivered.',
    rider_not_found: 'That rider no longer exists.',
    store_not_found: 'That store no longer exists.',
    store_name_taken: 'A store with that name already exists. Pick another name.',
  };
  return messages[err.code] ?? `Request failed (${err.code}).`;
}
