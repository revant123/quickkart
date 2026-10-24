import { config } from '../config.js';

// Every message QuickKart sends, as plain text plus simple HTML. Kept as code
// (not files) so a missing field is a type error, not a blank email.

const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(iso));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const orderLink = (orderId: string | number) => `${config.APP_URL}/orders/${orderId}`;

export type TemplateData = {
  verify_email: { name: string; link: string };
  reset_password: { name: string; link: string };
  order_placed: {
    name: string; orderId: string; totalPaise: number; slotStart: string; storeName: string;
    paymentMethod: 'cod' | 'online';
  };
  order_out_for_delivery: { name: string; orderId: string; riderName: string; totalPaise: number; cashDue: boolean };
  order_delivered: { name: string; orderId: string; totalPaise: number };
  order_cancelled: { name: string; orderId: string; refundPaise: number | null; reason: 'customer' | 'store' | 'payment_expired' };
  payment_refunded: { name: string; orderId: string; amountPaise: number };
};
export type Template = keyof TemplateData;

export type Rendered = { subject: string; text: string; html: string; sms: string };

type Renderers = { [K in Template]: (d: TemplateData[K]) => Rendered };

function page(title: string, paragraphs: string[], button?: { href: string; label: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px">${p}</p>`).join('');
  const btn = button
    ? `<p style="margin:20px 0"><a href="${esc(button.href)}" style="background:#17301f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#17301f;max-width:520px;margin:0 auto;padding:24px">
<p style="font-weight:800;font-size:18px;margin:0 0 20px">QuickKart</p>
<h1 style="font-size:20px;margin:0 0 14px">${esc(title)}</h1>${body}${btn}
<p style="color:#4a5d50;font-size:12px;margin-top:28px">QuickKart is a student project. No real goods are delivered.</p>
</body></html>`;
}

const renderers: Renderers = {
  verify_email: (d) => ({
    subject: 'Confirm your email for QuickKart',
    text: `Hi ${d.name},\n\nConfirm your email to start ordering:\n${d.link}\n\nThe link works for 24 hours. If you didn't create a QuickKart account, ignore this email.`,
    html: page('Confirm your email', [
      `Hi ${esc(d.name)}, confirm your email address to start ordering.`,
      'The link works for 24 hours. If you didn’t create a QuickKart account, ignore this email.',
    ], { href: d.link, label: 'Confirm email' }),
    sms: '',
  }),
  reset_password: (d) => ({
    subject: 'Reset your QuickKart password',
    text: `Hi ${d.name},\n\nSet a new password here:\n${d.link}\n\nThe link works for 1 hour and only once. If you didn't ask for this, ignore this email: your password stays the same.`,
    html: page('Reset your password', [
      `Hi ${esc(d.name)}, someone (hopefully you) asked to reset your QuickKart password.`,
      'The link works for 1 hour and only once. If you didn’t ask for this, ignore this email: your password stays the same.',
    ], { href: d.link, label: 'Choose a new password' }),
    sms: '',
  }),
  order_placed: (d) => {
    const pay = d.paymentMethod === 'cod' ? `Pay ${rupees(d.totalPaise)} in cash when it arrives.` : `Paid ${rupees(d.totalPaise)} online.`;
    return {
      subject: `Order #${d.orderId} placed, arriving from ${when(d.slotStart)}`,
      text: `Hi ${d.name},\n\nYour order #${d.orderId} from ${d.storeName} is placed. It arrives from ${when(d.slotStart)}.\n${pay}\n\nTrack it: ${orderLink(d.orderId)}`,
      html: page(`Order #${d.orderId} is placed`, [
        `Hi ${esc(d.name)}, your order from ${esc(d.storeName)} arrives from <b>${esc(when(d.slotStart))}</b>.`,
        esc(pay),
      ], { href: orderLink(d.orderId), label: 'Track your order' }),
      sms: `QuickKart: order #${d.orderId} placed, arriving from ${when(d.slotStart)}. ${pay}`,
    };
  },
  order_out_for_delivery: (d) => {
    const cash = d.cashDue ? ` Keep ${rupees(d.totalPaise)} ready in cash.` : '';
    return {
      subject: `Order #${d.orderId} is on its way`,
      text: `Hi ${d.name},\n\n${d.riderName} has picked up order #${d.orderId} and is on the way.${cash}\n\n${orderLink(d.orderId)}`,
      html: page(`Order #${d.orderId} is on its way`, [
        `${esc(d.riderName)} has picked up your order and is on the way.${esc(cash)}`,
      ], { href: orderLink(d.orderId), label: 'See your order' }),
      sms: `QuickKart: ${d.riderName} is on the way with order #${d.orderId}.${cash}`,
    };
  },
  order_delivered: (d) => ({
    subject: `Order #${d.orderId} delivered`,
    text: `Hi ${d.name},\n\nOrder #${d.orderId} (${rupees(d.totalPaise)}) has been delivered. Enjoy!\n\n${orderLink(d.orderId)}`,
    html: page(`Order #${d.orderId} delivered`, [
      `Hi ${esc(d.name)}, your order (${esc(rupees(d.totalPaise))}) has been delivered. Enjoy!`,
    ]),
    sms: '',
  }),
  order_cancelled: (d) => {
    const why = { customer: 'You cancelled it.', store: 'The store cancelled it.', payment_expired: 'The online payment wasn’t completed in time.' }[d.reason];
    const refund = d.refundPaise ? ` A refund of ${rupees(d.refundPaise)} is on its way to your original payment method.` : '';
    return {
      subject: `Order #${d.orderId} cancelled`,
      text: `Hi ${d.name},\n\nOrder #${d.orderId} is cancelled. ${why}${refund}\n\n${orderLink(d.orderId)}`,
      html: page(`Order #${d.orderId} cancelled`, [`${esc(why)}${esc(refund)}`]),
      sms: '',
    };
  },
  payment_refunded: (d) => ({
    subject: `Refund of ${rupees(d.amountPaise)} for order #${d.orderId}`,
    text: `Hi ${d.name},\n\nWe've refunded ${rupees(d.amountPaise)} for order #${d.orderId}. Banks usually show it within 5-7 working days.`,
    html: page('Your refund is on its way', [
      `We’ve refunded ${esc(rupees(d.amountPaise))} for order #${esc(d.orderId)}. Banks usually show it within 5–7 working days.`,
    ]),
    sms: '',
  }),
};

export function render<K extends Template>(template: K, data: TemplateData[K]): Rendered {
  return renderers[template](data);
}
