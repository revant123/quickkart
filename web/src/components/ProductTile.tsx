import type { Product } from '../api/types';
import { formatPaise, productNoun } from '../lib/format';
import { useCart } from '../features/cart/CartContext';
import { QtyStepper } from './QtyStepper';

export function ProductTile({ product, storeId }: { product: Product; storeId: number }) {
  const { dispatch, quantityOf, cart } = useCart();
  const id = Number(product.id);
  // Only count it as "in the cart" if the cart is for this store
  const qty = cart.storeId === storeId ? quantityOf(id) : 0;

  const add = () =>
    dispatch({
      type: 'add',
      storeId,
      item: {
        productId: id,
        name: product.name,
        unit: product.unit,
        category: product.category,
        pricePaise: product.price_paise,
      },
    });

  return (
    <article className={`tile${product.in_stock ? '' : ' sold-out'}`}>
      <div className={`swatch sw-${product.category}${product.image_url ? ' has-image' : ''}`} aria-hidden="true">
        <span className="unit-tag">{product.unit}</span>
        {product.image_url ? (
          <img src={product.image_url} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="noun">{productNoun(product.name)}</span>
        )}
      </div>
      <h3 className="tile-name small">{product.name}</h3>
      {product.in_stock && product.low_stock !== null && (
        <span className="low-stock">Only {product.low_stock} left</span>
      )}
      <div className="tile-foot">
        <span className="price">{formatPaise(product.price_paise)}</span>
        {!product.in_stock ? (
          <span className="sold-out-label">Sold out</span>
        ) : qty === 0 ? (
          <button className="add-btn" onClick={add} aria-label={`Add ${product.name} to cart`}>
            Add
          </button>
        ) : (
          <QtyStepper
            name={product.name}
            quantity={qty}
            max={product.low_stock ?? undefined}
            onChange={(q) => dispatch({ type: 'setQty', productId: id, quantity: q })}
          />
        )}
      </div>
    </article>
  );
}
