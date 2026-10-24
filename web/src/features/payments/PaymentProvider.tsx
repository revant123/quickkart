import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../../api/client';
import type { PaymentStart, PaymentSuccess } from '../../api/types';
import { formatPaise } from '../../lib/format';
import { Modal } from '../../components/Modal';

// ---------------------------------------------------------------------------
// Paying for an order, whichever gateway the server uses:
//   1. POST /orders/:id/payment          -> gateway order (amount, keys)
//   2. open the payment window           -> Razorpay Checkout, or our test window
//   3. POST /orders/:id/payment/verify   -> the SERVER checks the signature
// The browser never decides that an order is paid; it only passes the
// gateway's signed answer to the server.
// ---------------------------------------------------------------------------

type PayResult = 'paid' | 'dismissed';
const Ctx = createContext<{ pay: (orderId: string) => Promise<PayResult> } | null>(null);

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, f: () => void) => void };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new ApiError(0, 'payment_gateway_unreachable'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

async function openRazorpay(orderId: string, start: PaymentStart): Promise<PaymentSuccess | null> {
  await loadRazorpay();
  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: start.keyId,
      amount: start.amountPaise,
      currency: start.currency,
      order_id: start.providerOrderId,
      name: 'QuickKart',
      description: `Order ${orderId}`,
      prefill: start.prefill,
      theme: { color: '#17301f' },
      handler: (r: PaymentSuccess) => resolve(r),
      // Closing the window isn't an error: the order waits, and can be paid later
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.open();
  });
}

type FakeState = { orderId: string; start: PaymentStart; resolve: (r: PaymentSuccess | null) => void };

export function PaymentProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [fake, setFake] = useState<FakeState | null>(null);

  const pay = useCallback(
    async (orderId: string): Promise<PayResult> => {
      const start = await api<PaymentStart>(`/orders/${orderId}/payment`, { method: 'POST' });
      const success =
        start.provider === 'razorpay'
          ? await openRazorpay(orderId, start)
          : await new Promise<PaymentSuccess | null>((resolve) => setFake({ orderId, start, resolve }));
      if (!success) return 'dismissed';
      await api(`/orders/${orderId}/payment/verify`, { method: 'POST', body: JSON.stringify(success) });
      qc.invalidateQueries({ queryKey: ['orders'] });
      return 'paid';
    },
    [qc],
  );

  return (
    <Ctx.Provider value={{ pay }}>
      {children}
      {fake && (
        <FakeGateway
          state={fake}
          done={(r) => {
            fake.resolve(r);
            setFake(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

export function usePayment() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePayment must be used inside PaymentProvider');
  return ctx;
}

/** Stands in for Razorpay's window when no Razorpay keys are set. No money moves. */
function FakeGateway({ state, done }: { state: FakeState; done: (r: PaymentSuccess | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const once = useRef(false);

  const attempt = async (outcome: 'success' | 'failure') => {
    setBusy(true);
    setError('');
    try {
      const r = await api<PaymentSuccess>('/payments/fake/pay', {
        method: 'POST',
        body: JSON.stringify({ providerOrderId: state.start.providerOrderId, outcome }),
      });
      if (!once.current) {
        once.current = true;
        done(r);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Test payment" onClose={() => done(null)} labelledBy="fake-pay-title">
      <p className="pay-amount">{formatPaise(state.start.amountPaise)}</p>
      <p className="muted small">
        Order {state.orderId}. This is QuickKart’s built-in test gateway, used because no Razorpay keys
        are set. No money moves. With keys set, Razorpay’s own window opens here instead.
      </p>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => attempt('success')}>
          {busy ? 'Paying…' : `Pay ${formatPaise(state.start.amountPaise)}`}
        </button>
        <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => attempt('failure')}>
          Simulate a declined payment
        </button>
      </div>
    </Modal>
  );
}
