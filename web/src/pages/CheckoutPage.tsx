import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../api/client';
import type { Address, PaymentMethod, PlacedOrder, Slot } from '../api/types';
import { useCart } from '../features/cart/CartContext';
import { cartTotal } from '../features/cart/cartReducer';
import { useStore } from '../features/store/StoreContext';
import { formatPaise, formatDay, formatTime, kmBetween } from '../lib/format';
import { Empty, ErrorNote, Spinner } from '../components/Feedback';
import { useMe } from '../features/auth/useAuth';
import { formatAddress, useAddresses } from '../features/addresses/addresses';
import { AddressForm } from '../features/addresses/AddressForm';
import { usePayment } from '../features/payments/PaymentProvider';
import { VerifyEmailNotice } from './AccountPages';

type Attempt = { payload: string; key: string };

export function CheckoutPage() {
  const { cart, dispatch } = useCart();
  const { stores } = useStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const storeId = cart.storeId;
  const store = stores.find((s) => Number(s.id) === storeId);
  const me = useMe();
  const { pay } = usePayment();
  const addresses = useAddresses();
  const [chosenAddress, setChosenAddress] = useState<string | null>(null);
  const [addingAddress, setAddingAddress] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('online');
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
    onSuccess: async (order) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      // Online: the order now holds its items; open the payment window straight away.
      // Closing it (or an error) is fine: the order page offers "Pay now" until it expires.
      if (order.paymentMethod === 'online') {
        try {
          await pay(order.orderId);
        } catch {
          /* shown on the order page */
        }
      }
      dispatch({ type: 'clear' }); // after the payment window, so the page behind it stays put
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

  // Which saved address? The one picked, else the default, else the first
  const list = addresses.data ?? [];
  const address: Address | undefined =
    list.find((a) => a.id === chosenAddress) ?? list.find((a) => a.is_default) ?? list[0];
  // Same distance rule as the server, checked here first for instant feedback
  const tooFar = (a: Address) =>
    store?.lat != null && store?.lng != null && kmBetween(a, { lat: store.lat, lng: store.lng }) > store.radius_km;
  const kmFromStore = (a: Address) =>
    store?.lat != null && store?.lng != null ? kmBetween(a, { lat: store.lat, lng: store.lng }).toFixed(1) : null;
  const unverified = me.data ? !me.data.email_verified : false;

  const addressError = touched && !address ? 'Add a delivery address.' : touched && address && tooFar(address)
    ? `${store?.name} doesn’t deliver this far. Pick a nearer address, or change store at the top of the page.` : '';
  const slotError = touched && !slotId ? 'Pick a delivery slot.' : '';
  const soldOutId =
    placeOrder.error instanceof ApiError && placeOrder.error.code === 'out_of_stock'
      ? (placeOrder.error.details as { productId?: number } | undefined)?.productId
      : undefined;
  const soldOutItem = cart.items.find((i) => i.productId === soldOutId);

  const submit = () => {
    setTouched(true);
    if (!address || tooFar(address) || !slotId) return;
    const payload = JSON.stringify({
      storeId,
      slotId,
      addressId: Number(address.id),
      paymentMethod,
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
          {me.data && <VerifyEmailNotice user={me.data} />}
          <section className="panel" aria-labelledby="address-title">
            <div className="section-title">
              <h2 id="address-title">Delivery address</h2>
              {!addingAddress && list.length > 0 && list.length < 10 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setAddingAddress(true)}>Add new</button>
              )}
            </div>
            {addresses.isPending ? (
              <Spinner label="Loading your addresses" />
            ) : addresses.isError ? (
              <ErrorNote error={addresses.error} onRetry={() => addresses.refetch()} />
            ) : addingAddress || list.length === 0 ? (
              <AddressForm
                submitLabel="Save and deliver here"
                onSaved={(a) => {
                  setChosenAddress(a.id);
                  setAddingAddress(false);
                }}
                onCancel={list.length ? () => setAddingAddress(false) : undefined}
              />
            ) : (
              <fieldset className="choice-list">
                <legend className="visually-hidden">Choose a delivery address</legend>
                {list.map((a) => {
                  const far = tooFar(a);
                  return (
                    <div className={`choice${far ? ' disabled' : ''}`} key={a.id}>
                      <input type="radio" name="address" id={`addr-${a.id}`} checked={address?.id === a.id}
                        onChange={() => setChosenAddress(a.id)} />
                      <label htmlFor={`addr-${a.id}`}>
                        <span className="when">{a.label}</span>
                        <span>{formatAddress(a)}</span>
                        <span className="muted small">
                          {a.phone}
                          {kmFromStore(a) && ` · ${kmFromStore(a)} km from ${store?.name}`}
                          {far && ' · too far for this store'}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            )}
            {addressError && <p className="error small" style={{ color: 'var(--chilli)' }}>{addressError}</p>}
          </section>

          <section className="panel" aria-labelledby="pay-title">
            <div className="section-title">
              <h2 id="pay-title">Payment</h2>
            </div>
            <fieldset className="choice-list">
              <legend className="visually-hidden">Choose how to pay</legend>
              <div className="choice">
                <input type="radio" name="pay" id="pay-online" checked={paymentMethod === 'online'}
                  onChange={() => setPaymentMethod('online')} />
                <label htmlFor="pay-online">
                  <span className="when">Pay online</span>
                  <span className="muted small">UPI, card or net banking, through Razorpay. Test mode: no real money.</span>
                </label>
              </div>
              <div className="choice">
                <input type="radio" name="pay" id="pay-cod" checked={paymentMethod === 'cod'}
                  onChange={() => setPaymentMethod('cod')} />
                <label htmlFor="pay-cod">
                  <span className="when">Cash on delivery</span>
                  <span className="muted small">Pay the rider when your order arrives.</span>
                </label>
              </div>
            </fieldset>
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
            Prices are confirmed when you place the order.{' '}
            {paymentMethod === 'online'
              ? 'Your items are held for 15 minutes while you pay.'
              : 'You pay the rider in cash.'}
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

          <button className="btn btn-primary btn-block" onClick={submit} disabled={placeOrder.isPending || unverified}>
            {placeOrder.isPending
              ? paymentMethod === 'online' ? 'Opening payment…' : 'Placing order…'
              : paymentMethod === 'online'
                ? `Pay ${formatPaise(cartTotal(cart))}`
                : `Place order, ${formatPaise(cartTotal(cart))}`}
          </button>
          {unverified && <p className="muted small">Confirm your email first (see the note on the left).</p>}
        </aside>
      </div>
    </div>
  );
}
