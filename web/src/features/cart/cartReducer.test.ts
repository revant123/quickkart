import { describe, it, expect } from 'vitest';
import { cartReducer, cartCount, cartTotal, emptyCart, MAX_QTY, type CartState } from './cartReducer';

const milk = { productId: 1, name: 'Fresh milk 1', unit: '1 l', category: 'dairy', pricePaise: 3000 };
const bread = { productId: 2, name: 'Daily bread 2', unit: '400 g', category: 'staples', pricePaise: 4500 };

const add = (s: CartState, item = milk, storeId = 1) => cartReducer(s, { type: 'add', storeId, item });

describe('cartReducer', () => {
  it('adds an item with quantity 1', () => {
    const s = add(emptyCart);
    expect(s).toEqual({ storeId: 1, items: [{ ...milk, quantity: 1 }] });
  });

  it('adding the same item again increases its quantity', () => {
    const s = add(add(emptyCart));
    expect(s.items).toHaveLength(1);
    expect(s.items[0].quantity).toBe(2);
  });

  it('never goes above the maximum quantity', () => {
    let s = emptyCart;
    for (let i = 0; i < MAX_QTY + 5; i++) s = add(s);
    expect(s.items[0].quantity).toBe(MAX_QTY);
  });

  it('adding from a different store starts a new cart', () => {
    const s = add(add(emptyCart, milk, 1), bread, 2);
    expect(s.storeId).toBe(2);
    expect(s.items.map((i) => i.productId)).toEqual([2]);
  });

  it('setting quantity to 0 removes the line; an empty cart resets the store', () => {
    let s = add(add(emptyCart, milk), bread);
    s = cartReducer(s, { type: 'setQty', productId: 1, quantity: 0 });
    expect(s.items.map((i) => i.productId)).toEqual([2]);
    s = cartReducer(s, { type: 'setQty', productId: 2, quantity: 0 });
    expect(s).toEqual(emptyCart);
  });

  it('remove and clear', () => {
    let s = add(add(emptyCart, milk), bread);
    s = cartReducer(s, { type: 'remove', productId: 2 });
    expect(s.items).toHaveLength(1);
    expect(cartReducer(s, { type: 'clear' })).toEqual(emptyCart);
  });

  it('counts items and totals in paise', () => {
    const s = add(add(add(emptyCart, milk), milk), bread); // 2 x 3000 + 1 x 4500
    expect(cartCount(s)).toBe(3);
    expect(cartTotal(s)).toBe(10500);
  });

  it('does not mutate the previous state', () => {
    const before = add(emptyCart);
    const snapshot = structuredClone(before);
    add(before);
    expect(before).toEqual(snapshot);
  });
});
