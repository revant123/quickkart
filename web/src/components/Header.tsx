import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { useCart } from '../features/cart/CartContext';
import { cartCount, cartTotal } from '../features/cart/cartReducer';
import { useStore } from '../features/store/StoreContext';
import { useLogout, useMe } from '../features/auth/useAuth';
import { formatPaise } from '../lib/format';

export function Header() {
  const { stores, storeId, setStoreId } = useStore();
  const { cart, open } = useCart();
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  const count = cartCount(cart);

  // Small bump on the cart count when it goes up: confirms the "Add" worked
  const [bump, setBump] = useState(false);
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) {
      setBump(true);
      const t = setTimeout(() => setBump(false), 350);
      prev.current = count;
      return () => clearTimeout(t);
    }
    prev.current = count;
  }, [count]);

  return (
    <header className="site-header">
      <div className="container">
        <Link to="/" className="brand" aria-label="QuickKart home">
          <span className="brand-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M2 4h12l-1.6 8H3.6z" fill="#E2A114" />
            </svg>
          </span>
          QuickKart
        </Link>

        {stores.length > 0 && (
          <div className="store-picker">
            <label htmlFor="store-select">Delivering from</label>
            <select
              id="store-select"
              value={storeId ?? ''}
              onChange={(e) => setStoreId(Number(e.target.value))}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="header-nav" aria-label="Main">
          {me.data?.role === 'admin' && (
            <NavLink to="/admin" className="nav-link optional">
              Admin
            </NavLink>
          )}
          {me.data ? (
            <>
              <NavLink to="/orders" className="nav-link">
                Orders
              </NavLink>
              <button
                className="nav-link optional"
                onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/') })}
              >
                Log out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="nav-link">
              Log in
            </NavLink>
          )}
          <button
            className={`cart-button${bump ? ' bump' : ''}`}
            onClick={open}
            aria-label={`Open cart, ${count} ${count === 1 ? 'item' : 'items'}`}
          >
            <span className="count">{count}</span>
            <span className="cart-total">{count ? formatPaise(cartTotal(cart)) : 'Cart'}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
