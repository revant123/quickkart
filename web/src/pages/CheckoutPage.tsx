import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../api/client';
import type { PlacedOrder, Slot } from '../api/types';
import { useCart } from '../features/cart/CartContext';
import { cartTotal } from '../features/cart/cartReducer';
import { useStore } from '../features/store/StoreContext';
import { formatPaise, formatDay, formatTime } from '../lib/format';
import { readStorage, writeStorage } from '../lib/storage';
import { Empty, ErrorNote, Spinner } from '../components/Feedback';

type Attempt = { payload: string; key: string };

export function CheckoutPage() {
  const { cart, dispatch } = useCart();
  const { stores } = useStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const storeId = cart.storeId;
  const store = stores.find((s) => Number(s.id) === storeId);
  const [address, setAddress] = useState<string>(() => readStorage('qk.address', ''));
  const [slotId, setSlotId] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);

  const slots = useQuery({
    queryKey: ['slots', storeId],
    queryFn: () => api<Slot[]>(`/stores/${storeId}/slots`),
    enabled: storeId !== null,
  });

  // ---- The idempotency key ------------------------------------------------
  // One key = one INTENDED order. Retries of the same order reuse the key, so the
  // server can't create it twice. If the cart, slot or address changes, it's a
  // different order, so it gets a new key.
  const attempt = useRef<Attempt | null>(null);

  const placeOrder = useMutation({
    mutationFn: (a: Attempt) =>
      api<PlacedOrder>('/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': a.key },
        body: a.payload,
      }),
    // Retrying a POST is safe ONLY because of the key. Retry network errors and 5xx;
    // never 4xx (out of stock won't fix itself by asking again).
    retry: (count, err) => err instanceof ApiError && (err.status === 0 || err.status >= 500) && count < 2,
    onSuccess: (order) => {
      dispatch({ type: 'clear' });
      writeStorage('qk.address', address.trim());
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      navigate(`/orders/${order.orderId}`, { replace: true, state: { justPlaced: true } });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'slot_unavailable') {
        setSlotId(null);
        slots.refetch();
      }
    },
  });

  if (!storeId || cart.items.length === 0) {
    return (
      <div className="page medium">
        <Empty title="Your cart is empty">
          <p>Add a few things from the shop, then come back here to check out.</p>
          <Link className="btn btn-dark" to="/">
            Go to the shop
          </Link>
        </Empty>
      </div>
    );
  }

  const addressError = touched && address.trim().length < 5 ? 'Enter your full delivery address.' : '';
  const slotError = touched && !slotId ? 'Pick a delivery slot.' : '';
  const soldOutId =
    placeOrder.error instanceof ApiError && placeOrder.error.code === 'out_of_stock'
      ? (placeOrder.error.details as { productId?: number } | undefined)?.productId
      : undefined;
  const soldOutItem = cart.items.find((i) => i.productId === soldOutId);

  const submit = () => {
    setTouched(true);
    if (address.trim().length < 5 || !slotId) return;
    const payload = JSON.stringify({
      storeId,
      slotId,
      address: address.trim(),
      items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    });
    if (!attempt.current || attempt.current.payload !== payload) {
      attempt.current = { payload, key: crypto.randomUUID() };
    }
    placeOrder.mutate(attempt.current);
  };

  return (
    <div className="page">
      <h1>Checkout</h1>
      <p className="muted">Delivering from {store?.name ?? 'your store'}.</p>

      <div className="checkout-grid">
        <div>
          <section className="panel" aria-labelledby="address-title">
            <div className="section-title">
              <h2 id="address-title">Delivery address</h2>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="address" className="visually-hidden">Delivery address</label>
              <textarea
                id="address"
                className="textarea"
                placeholder="House number, street, sector, city"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                aria-invalid={!!addressError}
              />
              {addressError && <span className="error">{addressError}</span>}
            </div>
          </section>

          <section className="panel" aria-labelledby="slot-title">
            <div className="section-title">
              <h2 id="slot-title">Delivery slot</h2>
              <span className="muted small">30-minute windows</span>
            </div>
            {slots.isPending ? (
              <Spinner label="Loading slots" />
            ) : slots.isError ? (
              <ErrorNote error={slots.error} onRetry={() => slots.refetch()} />
            ) : slots.data.length === 0 ? (
              <p className="muted">
                Every slot is full right now. Staff open new slots regularly, so check back soon.
              </p>
            ) : (
              <fieldset className="slot-list">
                <legend className="visually-hidden">Choose a delivery slot</legend>
                {slots.data.map((s) => (
                  <div className="slot-option" key={s.id}>
                    <input
                      type="radio"
                      name="slot"
                      id={`slot-${s.id}`}
                      checked={slotId === Number(s.id)}
                      onChange={() => setSlotId(Number(s.id))}
                    />
                    <label htmlFor={`slot-${s.id}`}>
                      <span className="when">
                        {formatTime(s.starts_at)}, {formatDay(s.starts_at)}
                      </span>
                      <span className="left">
                        {s.free} {s.free === 1 ? 'place' : 'places'} left
                      </span>
                    </label>
                  </div>
                ))}
              </fieldset>
            )}
            {slotError && <p className="error small" style={{ color: 'var(--chilli)' }}>{slotError}</p>}
          </section>
        </div>

        <aside className="panel" aria-labelledby="summary-title">
          <div className="section-title">
            <h2 id="summary-title">Your order</h2>
          </div>
          {cart.items.map((i) => (
            <div
              key={i.productId}
              className={`summary-line${i.productId === soldOutId ? ' problem' : ''}`}
            >
              <span>
                {i.quantity} × {i.name}
              </span>
              <span>{formatPaise(i.quantity * i.pricePaise)}</span>
            </div>
          ))}
          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '10px 0' }} />
          <div className="total-row">
            <span>Total</span>
            <span>{formatPaise(cartTotal(cart))}</span>
          </div>
          <p className="muted small">
            Prices are confirmed when you place the order. You pay on delivery.
          </p>

          {placeOrder.isError && (
            <div className="notice error" role="alert">
              {soldOutItem
                ? `${soldOutItem.name} just sold out. Remove it to place the rest of your order.`
                : errorMessage(placeOrder.error)}
              {soldOutItem && (
                <div className="actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      dispatch({ type: 'remove', productId: soldOutItem.productId });
                      placeOrder.reset();
                    }}
                  >
                    Remove {soldOutItem.name}
                  </button>
                </div>
              )}
            </div>
          )}

          <button className="btn btn-primary btn-block" onClick={submit} disabled={placeOrder.isPending}>
            {placeOrder.isPending ? 'Placing order…' : `Place order, ${formatPaise(cartTotal(cart))}`}
          </button>
        </aside>
      </div>
    </div>
  );
}
