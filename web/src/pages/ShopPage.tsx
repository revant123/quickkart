import { useSearchParams } from 'react-router';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, ProductPage } from '../api/types';
import { useStore } from '../features/store/StoreContext';
import { useCart } from '../features/cart/CartContext';
import { DeliveryBand } from '../components/DeliveryBand';
import { ProductTile } from '../components/ProductTile';
import { Empty, ErrorNote, Spinner } from '../components/Feedback';

const MIN_SEARCH = 3; // the trigram index needs at least 3 characters

/** A photo that stands for each aisle on its tile */
const AISLE_PHOTO: Record<string, string> = {
  dairy: 'paneer',
  'fruits-vegetables': 'tomato',
  snacks: 'chips',
  beverages: 'juice',
  staples: 'atta',
};

export function ShopPage() {
  const { storeId, stores } = useStore();
  const { cart } = useCart();

  // Search (typed in the header) and aisle both live in the URL: ?q=milk&category=dairy
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const q = (params.get('q') ?? '').trim();
  const searchTerm = q.length >= MIN_SEARCH ? q : '';
  const browsing = !category && !q; // the home view: delivery ticket, aisles and shelves

  const setCategory = (slug: string) => {
    const next = new URLSearchParams(params);
    if (slug) next.set('category', slug);
    else next.delete('category');
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
    staleTime: Infinity,
  });

  const otherStoreCart =
    cart.items.length > 0 && cart.storeId !== null && cart.storeId !== storeId
      ? stores.find((s) => Number(s.id) === cart.storeId)
      : undefined;

  return (
    <div className="container shop">
      {browsing && <DeliveryBand />}

      {otherStoreCart && (
        <div className="notice">
          Your cart has items from {otherStoreCart.name}. Adding something here starts a new cart for this store.
        </div>
      )}

      {browsing ? (
        <>
          <section aria-labelledby="aisles-title">
            <h2 id="aisles-title" className="section-heading">Shop by aisle</h2>
            <div className="aisle-tiles">
              {categories.data?.map((c) => (
                <button key={c.slug} className={`aisle-tile sw-${c.slug}`} onClick={() => setCategory(c.slug)}>
                  <img src={`/img/products/${AISLE_PHOTO[c.slug] ?? 'milk'}.webp`} alt="" loading="lazy" />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </section>
          {storeId !== null &&
            categories.data?.map((c) => (
              <Shelf key={c.slug} category={c} storeId={storeId} onSeeAll={() => setCategory(c.slug)} />
            ))}
        </>
      ) : (
        <Results
          storeId={storeId}
          q={q}
          searchTerm={searchTerm}
          category={category}
          categories={categories.data ?? []}
          setCategory={setCategory}
        />
      )}
    </div>
  );
}

/** One aisle as a row of products you can scroll sideways, with "See all". */
function Shelf({ category, storeId, onSeeAll }: { category: Category; storeId: number; onSeeAll: () => void }) {
  // Key starts with ['products', storeId] so live stock updates patch shelves too
  const shelf = useInfiniteQuery({
    queryKey: ['products', storeId, 'shelf', category.slug],
    queryFn: ({ signal }) =>
      api<ProductPage>(`/stores/${storeId}/products?category=${category.slug}&limit=12`, { signal }),
    initialPageParam: '',
    getNextPageParam: () => undefined,
  });
  const items = shelf.data?.pages[0]?.items ?? [];
  if (shelf.isSuccess && items.length === 0) return null;

  return (
    <section className="shelf" aria-labelledby={`shelf-${category.slug}`}>
      <div className="shelf-head">
        <h2 id={`shelf-${category.slug}`} className="section-heading">{category.name}</h2>
        <button className="link-btn see-all" onClick={onSeeAll}>
          See all <span className="visually-hidden">{category.name}</span>
        </button>
      </div>
      {shelf.isPending ? (
        <Spinner label={`Loading ${category.name}`} />
      ) : shelf.isError ? (
        <ErrorNote error={shelf.error} onRetry={() => shelf.refetch()} />
      ) : (
        <div className="shelf-row">
          {items.map((p) => (
            <ProductTile key={p.id} product={p} storeId={storeId} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Search results or one aisle: a grid that loads more with the API's keyset cursor. */
function Results({
  storeId, q, searchTerm, category, categories, setCategory,
}: {
  storeId: number | null;
  q: string;
  searchTerm: string;
  category: string;
  categories: Category[];
  setCategory: (slug: string) => void;
}) {
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
    enabled: storeId !== null && (!q || searchTerm !== ''),
    // While a new search loads, keep showing the previous results instead of a spinner
    placeholderData: keepPreviousData,
  });
  const items = products.data?.pages.flatMap((p) => p.items) ?? [];
  const aisle = categories.find((c) => c.slug === category);
  const title = searchTerm ? `Results for “${searchTerm}”` : (aisle?.name ?? 'Everything');

  return (
    <section aria-labelledby="results-title" className="results">
      <div className="results-head">
        <h1 id="results-title">{title}</h1>
        <div className="chips" role="group" aria-label="Aisles">
          <button className="chip" aria-pressed={!category} onClick={() => setCategory('')}>
            {searchTerm ? 'All aisles' : 'Home'}
          </button>
          {categories.map((c) => (
            <button key={c.slug} className="chip" aria-pressed={category === c.slug} onClick={() => setCategory(c.slug)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {q && q.length < MIN_SEARCH ? (
        <p className="result-line">Type at least {MIN_SEARCH} letters to search.</p>
      ) : products.isPending ? (
        <Spinner label="Loading products" />
      ) : products.isError ? (
        <ErrorNote error={products.error} onRetry={() => products.refetch()} />
      ) : items.length === 0 ? (
        <Empty title={searchTerm ? `Nothing matches “${searchTerm}”` : 'Nothing in this aisle yet'}>
          <p>Try a different word, or look in another aisle.</p>
        </Empty>
      ) : (
        <>
          <div
            className="product-grid"
            aria-busy={products.isPlaceholderData}
            style={{ opacity: products.isPlaceholderData ? 0.6 : 1 }}
          >
            {items.map((p) => (
              <ProductTile key={p.id} product={p} storeId={storeId!} />
            ))}
          </div>
          {products.hasNextPage && (
            <div className="load-more">
              <button className="btn btn-ghost" onClick={() => products.fetchNextPage()} disabled={products.isFetchingNextPage}>
                {products.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
