import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import pg from 'pg';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Live updates: stock, delivery slots and order status, pushed to browsers.
//
//  1. Code that changes data calls `notifyLive(db, event)` INSIDE its
//     transaction. That runs PostgreSQL's pg_notify, which is delivered only
//     if the transaction COMMITS. A failed checkout announces nothing.
//  2. Every API instance keeps one connection that LISTENs on the channel, so
//     an order handled by container A reaches browsers connected to container B.
//  3. Each instance forwards events to its connected browsers as
//     Server-Sent Events (SSE): a long-lived HTTP response the server keeps
//     writing to. The browser's EventSource reconnects by itself if it drops.
// ---------------------------------------------------------------------------

const CHANNEL = 'quickkart_live';

export type StockItem = { productId: number; stock: number; pricePaise?: number; listed?: boolean };

export type LiveEvent =
  | { type: 'stock'; storeId: number; items: StockItem[] }
  | { type: 'slot'; storeId: number; slotId: number; free: number }
  | { type: 'order'; storeId: number; userId: number; orderId: number; status: string; riderId?: number | null };

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Queue an event; it is sent when (and only if) the surrounding transaction commits. */
export async function notifyLive(db: Queryable, event: LiveEvent) {
  await db.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
}

// What customers may see about stock: in or out, and a count only when it's low
export const LOW_STOCK = 5;
export function stockView(stock: number) {
  return { in_stock: stock > 0, low_stock: stock > 0 && stock <= LOW_STOCK ? stock : null };
}

// ---- Listening to PostgreSQL --------------------------------------------------

export const liveBus = new EventEmitter();
liveBus.setMaxListeners(0); // one listener per connected browser

let listener: pg.Client | null = null;
let stopped = false;

/** Opens the LISTEN connection (reconnecting if it drops). Call once at start-up. */
export async function startLive(): Promise<void> {
  stopped = false;
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      liveBus.emit('event', JSON.parse(msg.payload) as LiveEvent);
    } catch {
      /* ignore malformed payloads */
    }
  });
  client.on('error', () => reconnect());
  client.on('end', () => reconnect());
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  listener = client;
}

let reconnecting = false;
function reconnect() {
  if (stopped || reconnecting) return;
  reconnecting = true;
  listener = null;
  setTimeout(async () => {
    reconnecting = false;
    try {
      await startLive();
    } catch {
      reconnect();
    }
  }, 1000).unref();
}

export async function stopLive() {
  stopped = true;
  await listener?.end().catch(() => {});
  listener = null;
}

// ---- Server-Sent Events to browsers ------------------------------------------

/**
 * Turns `res` into an SSE stream. `filter` decides which events this client
 * receives and how they look (return null to skip). Ends when the browser leaves.
 */
export function openStream(
  req: Request,
  res: Response,
  filter: (e: LiveEvent) => { event: string; data: unknown } | null,
) {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to buffer this response
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n'); // browser reconnects after 3 s if dropped

  const onEvent = (e: LiveEvent) => {
    const out = filter(e);
    if (out) res.write(`event: ${out.event}\ndata: ${JSON.stringify(out.data)}\n\n`);
  };
  liveBus.on('event', onEvent);

  // A comment line every 25 s keeps proxies from closing an idle connection
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  ping.unref();

  req.on('close', () => {
    clearInterval(ping);
    liveBus.off('event', onEvent);
  });
}
