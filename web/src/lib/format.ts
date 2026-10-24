import type { OrderStatus, PaymentMethod, PaymentStatus } from '../api/types';

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

/** 4550 paise -> "₹45.50". Money is integer paise everywhere; convert only for display. */
export const formatPaise = (paise: number) => rupees.format(paise / 100);

const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export const formatTime = (iso: string) => time.format(new Date(iso));

/** "today", "tomorrow" or "Mon, 26 Oct" */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date())) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return weekday.format(d);
}

/** "7:30 pm – 8:00 pm today" */
export const formatSlot = (startIso: string, endIso: string) =>
  `${formatTime(startIso)} – ${formatTime(endIso)} ${formatDay(startIso)}`;

export const formatDateTime = (iso: string) => `${dayMonth.format(new Date(iso))}, ${formatTime(iso)}`;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PLACED: 'Placed',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

/**
 * The word shown big on a product tile: the last alphabetic word of the name.
 * "Organic paneer 4242" -> "paneer"; "Cola 100% Juice" -> "juice".
 */
export function productNoun(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[a-z]+$/i.test(w));
  return (words.at(-1) ?? name).toLowerCase();
}

/** One line about the money, for order pages: "Cash on delivery", "Paid online", ... */
export function paymentLabel(method: PaymentMethod, status: PaymentStatus): string {
  if (method === 'cod') return status === 'paid' ? 'Paid in cash' : 'Cash on delivery';
  return {
    unpaid: 'Online', pending: 'Waiting for online payment', paid: 'Paid online',
    failed: 'Online payment not completed', refund_pending: 'Refund on its way', refunded: 'Refunded',
  }[status];
}

/** 125 -> "2:05" (minutes:seconds), for payment countdowns */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Straight-line distance in km between two points (haversine), same formula as the server */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
