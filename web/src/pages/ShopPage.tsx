import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, ProductPage } from '../api/types';
import { useStore } from '../features/store/StoreContext';
import { useCart } from '../features/cart/CartContext';
import { useDebounce } from '../hooks/useDebounce';
import { DeliveryBand } from '../components/DeliveryBand';
import { ProductTile } from '../components/ProductTile';
import { Empty, ErrorNote, Spinner } from '../components/Feedback';

const MIN_SEARCH = 3; // the trigram index needs at least 3 characters

export function ShopPage() {
  const { storeId, stores } = useStore();
  const { cart } = useCart();

  // Search and category live in the URL (?q=milk&category=dairy):
  // the back button works, refresh keeps the search, and searches can be shared as links.
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounce(text.trim(), 300);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (q) next.set('q', q);
    else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [q]); // only when the debounced text changes

  const setCategory = (slug: string) => {
    const next = new URLSearchParams(params);
    if (slug) next.set('category', slug);
    else next.delete('category');
    setParams(next);
  };

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
    staleTime: Infinity,
  });

  const searchTerm = q.length >= MIN_SEARCH ? q : '';

  // Server state: TanStack Query caches pages, dedupes requests, and cancels stale ones.
  // useInfiniteQuery follows the API's keyset cursor for "Load more".
  const products = useInfiniteQuery({
    queryKey: ['products', storeId, searchTerm, category],
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '24' });
      if (searchTerm) p.set('q', searchTerm);
      if (category) p.set('category', category);
      if (pageParam) p.set('cursor', pageParam);
      return api<ProductPage>(`/stores/${storeId}/products?${p}`, { signal });
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: storeId !== null,
  });

  const items = products.data?.pages.flatMap((p) => p.items) ?? [];
  const otherStoreCart =
    cart.items.length > 0 && cart.storeId !== null && cart.storeId !== storeId
      ? stores.find((s) => Number(s.id) === cart.storeId)
      : undefined;

  return (
    <>
      <DeliveryBand />
      <div className="container">
        <div className="shop-tools">
          <div className="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.2" />
              <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <label htmlFor="search" className="visually-hidden">
              Search products
            </label>
            <input
              id="search"
              type="search"
              placeholder="Search milk, paneer, chips…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="chips" role="group" aria-label="Aisles">
            <button className="chip" aria-pressed={!category} onClick={() => setCategory('')}>
              Everything
            </button>
            {categories.data?.map((c) => (
              <button
                key={c.slug}
                className="chip"
                aria-pressed={category === c.slug}
                onClick={() => setCategory(c.slug)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {otherStoreCart && (
          <div className="notice">
            Your cart has items from {otherStoreCart.name}. Adding something here starts a new
            cart for this store.
          </div>
        )}

        {q.length > 0 && q.length < MIN_SEARCH && (
          <p className="result-line">Type at least {MIN_SEARCH} letters to search.</p>
        )}

        {products.isPending ? (
          <Spinner label="Loading products" />
        ) : products.isError ? (
          <ErrorNote error={products.error} onRetry={() => products.refetch()} />
        ) : items.length === 0 ? (
          <Empty title={searchTerm ? `Nothing matches “${searchTerm}”` : 'Nothing in this aisle yet'}>
            <p>Try a different word, or look in another aisle.</p>
          </Empty>
        ) : (
          <>
            {searchTerm && (
              <p className="result-line">
                Showing results for “{searchTerm}”{category ? ' in this aisle' : ''}
              </p>
            )}
            <div className="product-grid">
              {items.map((p) => (
                <ProductTile key={p.id} product={p} storeId={storeId!} />
              ))}
            </div>
            {products.hasNextPage && (
              <div className="load-more">
                <button
                  className="btn btn-ghost"
                  onClick={() => products.fetchNextPage()}
                  disabled={products.isFetchingNextPage}
                >
                  {products.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
