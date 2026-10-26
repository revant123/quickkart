import { useLocation } from 'react-router';
import { useCart } from '../features/cart/CartContext';
import { cartCount, cartTotal } from '../features/cart/cartReducer';
import { formatPaise } from '../lib/format';

/** On phones, the cart sits at the bottom of the screen, under your thumb, once it has something in it. */
export function MobileCartBar() {
  const { cart, open, isOpen } = useCart();
  const { pathname } = useLocation();
  const count = cartCount(cart);
  const hidden = count === 0 || isOpen || pathname.startsWith('/checkout') || pathname.startsWith('/admin') || pathname.startsWith('/rider');
  if (hidden) return null;
  return (
    <div className="mobile-cart-bar">
      <button onClick={open}>
        <span>
          <strong>{count} {count === 1 ? 'item' : 'items'}</strong>
          <span>{formatPaise(cartTotal(cart))}</span>
        </span>
        <span className="go">View cart</span>
      </button>
    </div>
  );
}
