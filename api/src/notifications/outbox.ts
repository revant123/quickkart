import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { pool, type Queryable } from '../db.js';
import type { Job } from '../jobs.js';
import { render, type Template, type TemplateData } from './templates.js';

// ---------------------------------------------------------------------------
// The transactional outbox.
//
// Problem: "commit the order, then send the email" can fail in between (crash,
// SMTP down), and "send the email, then commit" can email about an order that
// then rolls back. Neither is acceptable.
//
// Fix: INSERT the message into the `outbox` table inside the SAME transaction
// as the change. It is saved if and only if the change commits. A background
// job then sends pending messages and retries failures with backoff.
// Delivery is "at least once": after a crash mid-send, a message can go twice.
// ---------------------------------------------------------------------------

export async function enqueue<K extends Template>(
  db: Queryable,
  channel: 'email' | 'sms',
  recipient: string,
  template: K,
  data: TemplateData[K],
) {
  await db.query('INSERT INTO outbox (channel, recipient, template, data) VALUES ($1, $2, $3, $4)', [
    channel, recipient, template, data,
  ]);
}

/** Order events: email the customer, and text them for the ones worth a text. */
type OrderEvent = 'order_placed' | 'order_out_for_delivery' | 'order_delivered' | 'order_cancelled' | 'payment_refunded';
const ALSO_SMS: OrderEvent[] = ['order_placed', 'order_out_for_delivery'];

export async function notifyOrder(
  db: Queryable,
  orderId: number | string,
  event: OrderEvent,
  extra: { reason?: 'customer' | 'store' | 'payment_expired'; refundPaise?: number | null } = {},
) {
  const { rows } = await db.query(
    `SELECT o.id, o.total_paise, o.payment_method, o.payment_status, o.phone, ds.starts_at,
            s.name AS store_name, u.email, u.name, r.name AS rider_name
       FROM orders o
       JOIN users u ON u.id = o.user_id
       JOIN stores s ON s.id = o.store_id
       JOIN delivery_slots ds ON ds.id = o.slot_id
       LEFT JOIN users r ON r.id = o.rider_id
      WHERE o.id = $1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) return;
  const base = { name: o.name as string, orderId: String(o.id) };
  const data = {
    order_placed: { ...base, totalPaise: o.total_paise, slotStart: new Date(o.starts_at).toISOString(), storeName: o.store_name, paymentMethod: o.payment_method },
    order_out_for_delivery: { ...base, riderName: o.rider_name ?? 'Your rider', totalPaise: o.total_paise, cashDue: o.payment_method === 'cod' },
    order_delivered: { ...base, totalPaise: o.total_paise },
    order_cancelled: { ...base, refundPaise: extra.refundPaise ?? null, reason: extra.reason ?? 'customer' },
    payment_refunded: { ...base, amountPaise: extra.refundPaise ?? o.total_paise },
  }[event];
  await enqueue(db, 'email', o.email, event, data as never);
  if (ALSO_SMS.includes(event) && o.phone) await enqueue(db, 'sms', o.phone, event, data as never);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type OutgoingMail = { to: string; subject: string; text: string; html?: string };
export type Mailer = (mail: OutgoingMail) => Promise<void>;

function defaultMailer(): Mailer {
  if (!config.SMTP_URL) {
    // No SMTP server configured: print the message so links can still be clicked
    return async (m) => {
      console.log(`[mail] to ${m.to}: ${m.subject}\n${m.text}\n`);
    };
  }
  const transport = nodemailer.createTransport(config.SMTP_URL);
  return async (m) => {
    await transport.sendMail({ from: config.MAIL_FROM, ...m });
  };
}

let mailer: Mailer = defaultMailer();
/** Tests replace the mailer to capture or fail messages. Returns the previous one. */
export function setMailer(m: Mailer): Mailer {
  const prev = mailer;
  mailer = m;
  return prev;
}

const MAX_ATTEMPTS = 8;
const BATCH = 20;
/** 30 s, 1 min, 2 min, 4 min... capped at 1 hour */
const backoffSeconds = (attempts: number) => Math.min(3600, 30 * 2 ** (attempts - 1));

function toMail(row: { channel: string; recipient: string; template: Template; data: never }): OutgoingMail {
  const r = render(row.template, row.data);
  if (row.channel === 'sms') {
    // No free SMS gateway: deliver the text to the inbox, clearly labelled
    return { to: `${row.recipient}@${config.SMS_EMAIL_DOMAIN}`, subject: `SMS to +91 ${row.recipient}`, text: r.sms };
  }
  return { to: row.recipient, subject: r.subject, text: r.text, html: r.html };
}

/** Sends up to one batch of due messages. Returns how many were sent and failed. */
export async function drainOutbox(): Promise<{ sent: number; failed: number }> {
  // Claim a batch with a LEASE: push next_attempt_at 2 minutes ahead. If this
  // process dies mid-send, the lease runs out and the messages are retried.
  // SKIP LOCKED: two senders never claim the same row.
  const { rows } = await pool.query(
    `UPDATE outbox SET attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
      WHERE id IN (SELECT id FROM outbox
                    WHERE status = 'pending' AND next_attempt_at <= now()
                    ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING id, channel, recipient, template, data, attempts`,
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await mailer(toMail(row));
      await pool.query(`UPDATE outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = $1`, [row.id]);
      sent++;
    } catch (e) {
      failed++;
      const giveUp = row.attempts >= MAX_ATTEMPTS;
      await pool.query(
        `UPDATE outbox SET status = $2, last_error = $3,
                next_attempt_at = now() + make_interval(secs => $4)
          WHERE id = $1`,
        [row.id, giveUp ? 'failed' : 'pending', String((e as Error).message).slice(0, 500), backoffSeconds(row.attempts)],
      );
    }
  }
  return { sent, failed };
}

export const sendOutbox: Job = {
  name: 'send-notifications',
  everyMs: config.OUTBOX_POLL_MS,
  lockId: 7_320_002,
  async run() {
    const { sent, failed } = await drainOutbox();
    if (sent || failed) return `sent ${sent}, failed ${failed}`;
  },
};
