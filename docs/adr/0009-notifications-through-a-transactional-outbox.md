# ADR 0009: Emails and SMS through a transactional outbox

**Status:** accepted

## Context
QuickKart emails and texts customers: confirm your email, reset your password, order
placed, on its way (with the rider's name), delivered, cancelled, refunded. A message must
go out **if and only if** the change it describes really happened. Two naive orders both fail:
- *commit, then send*: a crash or an SMTP outage in between loses the message;
- *send, then commit*: the email goes out, then the transaction rolls back (out of stock),
  and the customer is told about an order that doesn't exist.

## Decision
- **Write the message into an `outbox` table in the same transaction** as the change
  (`enqueue(db, ...)`). It commits or rolls back with the order. Tested: a checkout that
  fails for "out of stock" leaves the outbox empty.
- **A background job sends due messages** every 2 s. It claims a batch with a *lease*
  (`next_attempt_at = now() + 2 min`, `FOR UPDATE SKIP LOCKED`), sends, then marks each
  `sent`. Failures retry with exponential backoff (30 s, 1, 2, 4... min, max 1 h) and are
  marked `failed` after 8 attempts.
- **Delivery is at least once.** If the process dies after sending but before marking
  `sent`, the lease runs out and the message goes again. A duplicate "order placed" email
  is far better than none.
- **Email over SMTP** (nodemailer): Mailpit in Docker Compose, so every message can be read
  at http://localhost:8025 without sending anything real; Resend's SMTP when deployed.
- **SMS without an SMS provider:** there is no free SMS gateway, so texts go to the same
  inbox as `<phone>@sms.quickkart.test` with the subject "SMS to +91 ...". Swapping in a
  real provider means changing one function (`toMail`).
- **Account links are single-use tokens:** 256 random bits in the link, only a SHA-256 hash
  stored, an expiry (24 h for email, 1 h for password reset), and one conditional UPDATE to
  use them, so two clicks can't both succeed. A password reset bumps `token_version`, which
  logs out every existing session (ADR 0004).

## Consequences
- **Good:** no lost or phantom messages; a mail outage delays emails but never breaks checkout.
- **Good:** the outbox is a log of everything that was sent, with errors.
- **Cost:** messages arrive a second or two after the change, not instantly.
- **Cost:** the table grows; a clean-up job for old `sent` rows would be the next step.
- **Alternatives considered:** sending inside the request (slow, and the failure cases
  above); a message broker such as RabbitMQ (another service, and publishing still isn't
  tied to the database commit without an outbox anyway).
