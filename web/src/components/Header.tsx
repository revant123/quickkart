import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useCart } from '../features/cart/CartContext';
import { cartCount, cartTotal } from '../features/cart/cartReducer';
import { useLogout, useMe } from '../features/auth/useAuth';
import { formatPaise } from '../lib/format';
import { LocationButton } from '../features/location/LocationPicker';
import { useDebounce } from '../hooks/useDebounce';

export function Header() {
  const { cart, open } = useCart();
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const staffPage = pathname.startsWith('/admin') || pathname.startsWith('/rider');

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
      <div className="container header-row">
        <Link to="/" className="brand" aria-label="QuickKart home">
          <BrandMark />
          <span>QuickKart</span>
        </Link>

        <div className="header-location">
          <LocationButton />
        </div>

        {!staffPage && <HeaderSearch />}

        <nav className="header-nav" aria-label="Main">
          {me.data?.role === 'admin' && (
            <NavLink to="/admin" className="nav-link optional">Admin</NavLink>
          )}
          {me.data?.role === 'rider' && <NavLink to="/rider" className="nav-link">Deliveries</NavLink>}
          {me.data ? (
            <>
              <NavLink to="/orders" className="nav-link">Orders</NavLink>
              <NavLink to="/account" className="nav-link optional">Account</NavLink>
              <button
                className="nav-link optional"
                onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/') })}
              >
                Log out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="nav-link">Log in</NavLink>
          )}
          <button
            className={`cart-button${bump ? ' bump' : ''}`}
            onClick={open}
            aria-label={`Open cart, ${count} ${count === 1 ? 'item' : 'items'}`}
          >
            <CartIcon />
            <span className="cart-total">{count ? formatPaise(cartTotal(cart)) : 'Cart'}</span>
            {count > 0 && <span className="count">{count}</span>}
          </button>
        </nav>
      </div>
    </header>
  );
}

/**
 * The search box lives in the header, so it's one tap away on every page. The query
 * itself lives in the URL (/?q=paneer): back/forward work and searches can be shared.
 */
function HeaderSearch() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const urlQ = pathname === '/' ? (params.get('q') ?? '') : '';
  const [text, setText] = useState(urlQ);
  const q = useDebounce(text.trim(), 300);

  // The URL changed by itself (back button, an aisle link): show what it says
  useEffect(() => {
    if (urlQ !== q) setText(urlQ);
  }, [urlQ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (q === urlQ) return;
    if (pathname === '/') {
      const next = new URLSearchParams(params);
      if (q) next.set('q', q);
      else next.delete('q');
      setParams(next, { replace: true });
    } else if (q) {
      navigate(`/?q=${encodeURIComponent(q)}`);
    }
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form className="header-search" role="search" onSubmit={(e) => e.preventDefault()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
        <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <label htmlFor="search" className="visually-hidden">Search products</label>
      <input
        id="search"
        type="search"
        placeholder="Search milk, paneer, atta…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
      />
    </form>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24">
        <path d="M3.5 8h17l-2 11.5h-13z" fill="#0C7A43" />
        <path d="M8.2 8a3.8 3.8 0 0 1 7.6 0" fill="none" stroke="#15201A" strokeWidth="2" />
        <path d="M12.8 10.5 10 14.6h2.3l-.9 3.4 3.1-4.4h-2.3z" fill="#FFC72C" />
      </svg>
    </span>
  );
}

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="19.5" r="1.4" fill="currentColor" />
      <circle cx="17" cy="19.5" r="1.4" fill="currentColor" />
    </svg>
  );
}
