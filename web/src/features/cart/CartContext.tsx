import { createContext, useCallback, useContext, useEffect, useReducer, useState, type ReactNode } from 'react';
import { cartReducer, emptyCart, type CartAction, type CartState } from './cartReducer';
import { readStorage, writeStorage } from '../../lib/storage';

type CartCtx = {
  cart: CartState;
  dispatch: (a: CartAction) => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  quantityOf: (productId: number) => number;
};

const Ctx = createContext<CartCtx | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  // Lazy initialiser: load the saved cart once, on first render
  const [cart, dispatch] = useReducer(cartReducer, emptyCart, () =>
    readStorage<CartState>('qk.cart', emptyCart),
  );
  const [isOpen, setOpen] = useState(false);

  useEffect(() => writeStorage('qk.cart', cart), [cart]);

  // Stable functions (useCallback) so effects that depend on them don't re-run every render
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  const quantityOf = (productId: number) =>
    cart.items.find((i) => i.productId === productId)?.quantity ?? 0;

  return (
    <Ctx.Provider
      value={{ cart, dispatch, isOpen, open, close, quantityOf }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
