// The cart is CLIENT state: it exists only in this browser until checkout.
// A reducer is a pure function (state, action) -> new state: every cart change goes
// through one place, and it can be unit-tested without rendering anything.
//
// Prices here are for DISPLAY only. At checkout the server re-reads every price
// from the database, so a stale or tampered cart can never change what is charged.

export const MAX_QTY = 20; // the API accepts at most 20 of one item per order

export type CartItem = {
  productId: number;
  name: string;
  unit: string;
  category: string;
  pricePaise: number;
  quantity: number;
};

export type CartState = { storeId: number | null; items: CartItem[] };

export type CartAction =
  | { type: 'add'; storeId: number; item: Omit<CartItem, 'quantity'> }
  | { type: 'setQty'; productId: number; quantity: number }
  | { type: 'remove'; productId: number }
  | { type: 'clear' };

export const emptyCart: CartState = { storeId: null, items: [] };

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      // A cart belongs to ONE store (each store has its own stock and prices).
      // Adding from a different store starts a fresh cart.
      const items = state.storeId === action.storeId ? state.items : [];
      const found = items.find((i) => i.productId === action.item.productId);
      return {
        storeId: action.storeId,
        items: found
          ? items.map((i) =>
              i === found ? { ...i, quantity: Math.min(MAX_QTY, i.quantity + 1) } : i,
            )
          : [...items, { ...action.item, quantity: 1 }],
      };
    }
    case 'setQty': {
      const items = state.items
        .map((i) =>
          i.productId === action.productId
            ? { ...i, quantity: Math.max(0, Math.min(MAX_QTY, action.quantity)) }
            : i,
        )
        .filter((i) => i.quantity > 0);
      return items.length ? { ...state, items } : emptyCart;
    }
    case 'remove': {
      const items = state.items.filter((i) => i.productId !== action.productId);
      return items.length ? { ...state, items } : emptyCart;
    }
    case 'clear':
      return emptyCart;
  }
}

export const cartCount = (s: CartState) => s.items.reduce((n, i) => n + i.quantity, 0);
export const cartTotal = (s: CartState) => s.items.reduce((n, i) => n + i.quantity * i.pricePaise, 0);
