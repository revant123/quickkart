import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useCart } from './CartContext';
import { cartCount, cartTotal } from './cartReducer';
import { useStore } from '../store/StoreContext';
import { useLive } from '../live/LiveProvider';
import { QtyStepper } from '../../components/QtyStepper';
import { formatPaise } from '../../lib/format';

export function CartDrawer() {
  const { cart, dispatch, isOpen, close } = useCart();
  const { stores, storeId } = useStore();
  const live = useLive();
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes the drawer; focus moves into it when it opens
  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const cartStore = stores.find((s) => Number(s.id) === cart.storeId);
  const count = cartCount(cart);

  return (
    <>
      <div className="overlay" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
        <div className="drawer-head">
          <div>
            <h2 id="cart-title">Your cart</h2>
            {cartStore && <span className="muted small">From {cartStore.name}</span>}
          </div>
          <button ref={closeRef} className="icon-btn" onClick={close} aria-label="Close cart">
            ×
          </button>
        </div>

        <div className="drawer-body">
          {count === 0 ? (
            <div className="empty" style={{ marginTop: 16 }}>
              <h2>Your cart is empty</h2>
              <p>Add something from the shop and it will show up here.</p>
              <button className="btn btn-dark" onClick={close}>
                Browse the shop
              </button>
            </div>
          ) : (
            cart.items.map((item) => (
              <div className="cart-line" key={item.productId}>
                <div>
                  <div className="name">{item.name}</div>
                  <div className="meta">
                    {item.unit}, {formatPaise(item.pricePaise)} each
                  </div>
                  {(() => {
                    // Live stock for this item (only meaningful if the cart is for the store we're watching)
                    const s = cart.storeId === storeId ? live.stock.get(item.productId) : undefined;
                    if (s && !s.in_stock) {
                      return (
                        <div className="line-warning" role="status">
                          Just sold out.{' '}
                          <button className="link-btn" onClick={() => dispatch({ type: 'remove', productId: item.productId })}>
                            Remove
                          </button>
                        </div>
                      );
                    }
                    if (s?.low_stock != null && item.quantity > s.low_stock) {
                      return (
                        <div className="line-warning" role="status">
                          Only {s.low_stock} left.{' '}
                          <button className="link-btn" onClick={() => dispatch({ type: 'setQty', productId: item.productId, quantity: s.low_stock! })}>
                            Change to {s.low_stock}
                          </button>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div className="line-total">{formatPaise(item.pricePaise * item.quantity)}</div>
                <QtyStepper
                  name={item.name}
                  quantity={item.quantity}
                  onChange={(q) => dispatch({ type: 'setQty', productId: item.productId, quantity: q })}
                />
              </div>
            ))
          )}
        </div>

        {count > 0 && (
          <div className="drawer-foot">
            <div className="total-row">
              <span>Total</span>
              <span>{formatPaise(cartTotal(cart))}</span>
            </div>
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                close();
                navigate('/checkout');
              }}
            >
              Go to checkout
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
