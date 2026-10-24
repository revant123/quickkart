# ADR 0008: Online payments: hold the order, confirm by signature, expire, refund

**Status:** accepted

## Context
Customers can pay online through Razorpay or in cash on delivery. Paying online happens
in another system, over a network, with a human in the middle who may close the tab. The
rules that matter: never sell stock twice, never mark an unpaid order paid, never keep
money for an order that isn't delivered, and never block other shoppers while someone pays.

## Decision
- **Reserve first, pay second.** `POST /api/orders` with `paymentMethod: "online"` runs the
  same safe checkout as cash orders (stock, slot, idempotency key), but saves the order as
  `PENDING_PAYMENT` with `payment_expires_at = now() + 15 min`.
- **No network calls inside the checkout transaction.** The Razorpay order is created by a
  separate request, `POST /api/orders/:id/payment`. A slow gateway inside the transaction
  would keep the hot stock row locked and stall every other buyer (see ADR 0002).
- **Trust signatures, not the browser.** `POST /api/orders/:id/payment/verify` recomputes
  `HMAC-SHA256(order_id|payment_id, key_secret)` from the order id *we* stored and compares
  it in constant time (`timingSafeEqual`). Only then does the order move to `PLACED`.
- **The webhook is the safety net.** Razorpay also calls `POST /api/payments/razorpay/webhook`
  (raw body, `X-Razorpay-Signature` = HMAC of the body with the *webhook* secret). It covers
  customers who closed the tab after paying. Events are deduplicated by
  `x-razorpay-event-id` in `payment_events`, inside the same transaction as their effect.
- **Browser and webhook can race; both are safe.** `recordPayment` locks the payment row
  (`SELECT ... FOR UPDATE`) and does nothing if it's already paid. Tested: verify + two
  webhooks at once give one `PLACED` order and one confirmation email.
- **Expiry job** (every 30 s): cancels `PENDING_PAYMENT` orders past their deadline through
  the normal cancel path, so stock and the slot place come back.
- **Money after expiry is refunded, not lost.** If a payment lands after the order expired
  (or was cancelled), the order is marked `refund_pending`. A **refund job** (every 20 s,
  one instance at a time) calls the gateway's refund API and marks it `refunded`. Cancelling
  a paid order uses the same path.
- **A built-in test gateway** implements the same interface when no Razorpay keys are set,
  signing payments with the same HMAC scheme. The project runs with zero accounts, and the
  signature-checking code is exercised either way.

## Consequences
- **Good:** stock is never oversold and never held forever; customers are never charged
  without an order or a refund; checkout throughput is unaffected by the gateway.
- **Good:** every rule has a test (`api/test/payments.test.ts`), including Razorpay mode
  with Razorpay's API replaced by a fake `fetch`.
- **Cost:** a 15-minute hold means stock can look sold out while people decide to pay.
  Shorter windows trade that against people timing out at the payment page.
- **Cost:** the webhook needs a public HTTPS URL, so it only works once deployed.
  Locally, the verify endpoint is enough.
- **Not done:** reconciling with Razorpay's API before expiring an order (would catch a
  payment whose webhook is delayed). The refund path makes this safe, just slower.
- **Alternatives considered:** creating the gateway order inside the checkout transaction
  (locks held across a network call); trusting the browser's "success" callback (forgeable);
  reserving stock only after payment (two people can pay for the last item).
