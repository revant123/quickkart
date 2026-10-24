import { useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, uploadFile } from '../../api/client';
import type {
  AdminOrder, InventoryPage, InventoryRow, OrderStatus, SalesRow, SlotUse, TopProduct,
} from '../../api/types';
import { useStore } from '../../features/store/StoreContext';
import { useDebounce } from '../../hooks/useDebounce';
import { formatDateTime, formatPaise, formatSlot, formatTime, formatDay } from '../../lib/format';
import { Empty, ErrorNote, Spinner } from '../../components/Feedback';
import { StatusBadge } from '../OrderPages';
import { useEventSource } from '../../features/live/LiveProvider';

// Every request here goes to /api/admin/*, which the SERVER protects with
// requireAuth + requireRole('admin'). Hiding these pages from customers is just UX.

export function AdminLayout() {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  // One live stream for the whole admin area: new orders, status changes, stock edits
  useEventSource(
    '/api/admin/live',
    {
      order: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
        qc.invalidateQueries({ queryKey: ['admin', 'sales'] });
      },
      stock: () => qc.invalidateQueries({ queryKey: ['admin', 'inventory'] }),
      slot: () => qc.invalidateQueries({ queryKey: ['admin', 'slot-usage'] }),
    },
    setLive,
  );
  return (
    <div className="page">
      <div className="admin-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Store admin</h1>
          <span className="muted">Orders, stock, delivery slots and sales for every store.</span>
        </div>
        {live && (
          <span className="live-pill dark" title="This page updates as orders come in">
            <span className="live-dot" aria-hidden="true" /> Live
          </span>
        )}
      </div>
      <nav className="tabs" aria-label="Admin sections">
        <NavLink end to="/admin" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>Orders</NavLink>
        <NavLink to="/admin/inventory" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>Stock and prices</NavLink>
        <NavLink to="/admin/slots" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>Delivery slots</NavLink>
        <NavLink to="/admin/reports" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>Sales</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

/** Store dropdown used across admin pages. */
function StoreSelect({
  value, onChange, allowAll = false,
}: { value: number | ''; onChange: (v: number | '') => void; allowAll?: boolean }) {
  const { stores } = useStore();
  return (
    <>
      <label htmlFor="admin-store" className="visually-hidden">Store</label>
      <select
        id="admin-store"
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
      >
        {allowAll && <option value="">All stores</option>}
        {stores.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </>
  );
}

function useDefaultStore(): [number | '', (v: number | '') => void] {
  const { storeId } = useStore();
  const [value, setValue] = useState<number | '' | null>(null);
  return [value ?? storeId ?? '', setValue];
}

// ===========================================================================
// ORDERS: move orders through PLACED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED
// ===========================================================================

const NEXT_ACTIONS: Record<OrderStatus, { to: OrderStatus; label: string; danger?: boolean }[]> = {
  PLACED: [{ to: 'PACKED', label: 'Mark packed' }, { to: 'CANCELLED', label: 'Cancel', danger: true }],
  PACKED: [{ to: 'OUT_FOR_DELIVERY', label: 'Send out' }, { to: 'CANCELLED', label: 'Cancel', danger: true }],
  OUT_FOR_DELIVERY: [{ to: 'DELIVERED', label: 'Mark delivered' }],
  DELIVERED: [],
  CANCELLED: [],
};

const STATUS_FILTERS: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PLACED', label: 'To pack' },
  { value: 'PACKED', label: 'Packed' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function AdminOrdersPage() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState<number | ''>('');
  const [status, setStatus] = useState<OrderStatus | ''>('');

  const orders = useQuery({
    queryKey: ['admin', 'orders', storeId, status],
    queryFn: () => {
      const p = new URLSearchParams();
      if (storeId) p.set('storeId', String(storeId));
      if (status) p.set('status', status);
      return api<AdminOrder[]>(`/admin/orders?${p}`);
    },
    refetchInterval: 60_000, // safety net; live events refresh it instantly
  });

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: OrderStatus }) =>
      api(`/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: to }) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });

  return (
    <>
      <div className="toolbar">
        <StoreSelect value={storeId} onChange={setStoreId} allowAll />
        <div className="chips" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <button key={f.label} className="chip" aria-pressed={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {move.isError && <ErrorNote error={move.error} />}

      {orders.isPending ? (
        <Spinner label="Loading orders" />
      ) : orders.isError ? (
        <ErrorNote error={orders.error} onRetry={() => orders.refetch()} />
      ) : orders.data.length === 0 ? (
        <Empty title="No orders here">
          <p>Orders matching these filters will show up here as customers place them.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Store</th>
                <th>Delivery</th>
                <th className="num">Items</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.id}</strong>
                    <div className="muted small">{formatDateTime(o.created_at)}</div>
                  </td>
                  <td>{o.customer_email}</td>
                  <td>{o.store_name}</td>
                  <td>{formatTime(o.slot_start)}, {formatDay(o.slot_start)}</td>
                  <td className="num">{o.item_count}</td>
                  <td className="num">{formatPaise(o.total_paise)}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>
                    <div className="row-actions">
                      {NEXT_ACTIONS[o.status].map((a) => (
                        <button
                          key={a.to}
                          className={`btn btn-sm ${a.danger ? 'btn-danger' : 'btn-ghost'}`}
                          disabled={move.isPending}
                          onClick={() => move.mutate({ id: o.id, to: a.to })}
                        >
                          {a.label}
                        </button>
                      ))}
                      {NEXT_ACTIONS[o.status].length === 0 && <span className="muted small">Done</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// INVENTORY: stock is changed by +/- (relative), never "set to"
// ===========================================================================

export function AdminInventoryPage() {
  const [storeId, setStoreId] = useDefaultStore();
  const [text, setText] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const q = useDebounce(text.trim(), 300);

  const inventory = useInfiniteQuery({
    queryKey: ['admin', 'inventory', storeId, q, lowOnly],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ afterId: String(pageParam), limit: '50' });
      if (q.length >= 3) p.set('q', q);
      if (lowOnly) p.set('lowStockBelow', '5');
      return api<InventoryPage>(`/admin/stores/${storeId}/inventory?${p}`);
    },
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextAfterId ?? undefined,
    enabled: storeId !== '',
    placeholderData: keepPreviousData, // no spinner flash while typing a search
  });
  const rows = inventory.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="toolbar">
        <StoreSelect value={storeId} onChange={setStoreId} />
        <label htmlFor="inv-search" className="visually-hidden">Search products</label>
        <input id="inv-search" className="input" type="search" placeholder="Search products"
          value={text} onChange={(e) => setText(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Only items with fewer than 5 left
        </label>
      </div>
      <p className="muted small">
        Add stock when a delivery arrives (for example +24), or remove it for damaged items (−3).
        Stock is changed by an amount, never overwritten, so sales made while this page is open are kept.
      </p>

      {inventory.isPending ? (
        <Spinner label="Loading stock" />
      ) : inventory.isError ? (
        <ErrorNote error={inventory.error} onRetry={() => inventory.refetch()} />
      ) : rows.length === 0 ? (
        <Empty title="No products match">
          <p>Try another search, or turn off the low-stock filter.</p>
        </Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Product</th>
                  <th>Aisle</th>
                  <th className="num">In stock</th>
                  <th>Change stock</th>
                  <th>Price</th>
                  <th>In shop</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <InventoryRowView key={r.product_id} row={r} storeId={Number(storeId)} />
                ))}
              </tbody>
            </table>
          </div>
          {inventory.hasNextPage && (
            <div className="load-more">
              <button className="btn btn-ghost" onClick={() => inventory.fetchNextPage()} disabled={inventory.isFetchingNextPage}>
                {inventory.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function InventoryRowView({ row, storeId }: { row: InventoryRow; storeId: number }) {
  const qc = useQueryClient();
  const [delta, setDelta] = useState('');
  const [price, setPrice] = useState((row.price_paise / 100).toFixed(2));

  const update = useMutation({
    mutationFn: (body: { adjustStockBy?: number; pricePaise?: number; isListed?: boolean }) =>
      api<InventoryRow>(`/admin/stores/${storeId}/inventory/${row.product_id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setDelta('');
      qc.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const applyDelta = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(delta);
    if (Number.isInteger(n) && n !== 0) update.mutate({ adjustStockBy: n });
  };
  const savePrice = (e: FormEvent) => {
    e.preventDefault();
    const paise = Math.round(Number(price) * 100);
    if (paise > 0 && paise !== row.price_paise) update.mutate({ pricePaise: paise });
  };

  const photo = useMutation({
    mutationFn: (file: File | null) =>
      file
        ? uploadFile<{ image_url: string }>(`/admin/products/${row.product_id}/image`, 'image', file)
        : api<{ image_url: string }>(`/admin/products/${row.product_id}/image`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const custom = row.image_url?.startsWith('/api/');

  return (
    <tr>
      <td>
        <div className="photo-cell">
          {row.image_url ? <img src={row.image_url} alt="" className="thumb" /> : <span className="thumb empty" />}
          <div className="photo-actions">
            <label className="link-btn">
              {photo.isPending ? 'Uploading…' : custom ? 'Replace' : 'Upload'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="visually-hidden"
                disabled={photo.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) photo.mutate(f);
                  e.target.value = '';
                }}
              />
            </label>
            {custom && (
              <button className="link-btn" disabled={photo.isPending} onClick={() => photo.mutate(null)}>
                Remove
              </button>
            )}
          </div>
        </div>
        {photo.isError && <div className="small" style={{ color: 'var(--chilli)' }}>{errorMessage(photo.error)}</div>}
      </td>
      <td>
        {row.name} <span className="muted small">{row.unit}</span>
        {update.isError && <div className="small" style={{ color: 'var(--chilli)' }}>{errorMessage(update.error)}</div>}
      </td>
      <td>{row.category}</td>
      <td className={`num${row.stock < 5 ? ' stock-low' : ''}`}>{row.stock}</td>
      <td>
        <form className="inline-form" onSubmit={applyDelta}>
          <label className="visually-hidden" htmlFor={`d-${row.product_id}`}>Change stock of {row.name} by</label>
          <input id={`d-${row.product_id}`} className="input" type="number" step="1" placeholder="+24"
            value={delta} onChange={(e) => setDelta(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={update.isPending || !delta}>Apply</button>
        </form>
      </td>
      <td>
        <form className="inline-form" onSubmit={savePrice}>
          <label className="visually-hidden" htmlFor={`p-${row.product_id}`}>Price of {row.name} in rupees</label>
          <input id={`p-${row.product_id}`} className="input" type="number" min="0.01" step="0.01"
            value={price} onChange={(e) => setPrice(e.target.value)} />
          <button className="btn btn-ghost btn-sm"
            disabled={update.isPending || Math.round(Number(price) * 100) === row.price_paise}>Save</button>
        </form>
      </td>
      <td>
        <label className="check">
          <input type="checkbox" checked={row.is_listed} disabled={update.isPending}
            onChange={(e) => update.mutate({ isListed: e.target.checked })} />
          <span className="visually-hidden">Show {row.name} in the shop</span>
          {row.is_listed ? 'Shown' : 'Hidden'}
        </label>
      </td>
    </tr>
  );
}

// ===========================================================================
// DELIVERY SLOTS: open new slots, see how full the next 24 hours are
// ===========================================================================

/** 10:00 three days from now, in the format <input type="datetime-local"> wants
 *  (2026-10-27T10:00). The sample data already covers the next two days. */
function defaultSlotStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function AdminSlotsPage() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useDefaultStore();
  const [startsAt, setStartsAt] = useState(defaultSlotStart);
  const [duration, setDuration] = useState(30);
  const [capacity, setCapacity] = useState(5);

  const usage = useQuery({
    queryKey: ['admin', 'slot-usage', storeId],
    queryFn: () => api<SlotUse[]>(`/admin/reports/slots?storeId=${storeId}`),
    enabled: storeId !== '',
  });

  const create = useMutation({
    mutationFn: () =>
      api<SlotUse>(`/admin/stores/${storeId}/slots`, {
        method: 'POST',
        body: JSON.stringify({ startsAt: new Date(startsAt).toISOString(), durationMinutes: duration, capacity }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'slot-usage'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
    },
  });

  return (
    <>
      <div className="toolbar">
        <StoreSelect value={storeId} onChange={setStoreId} />
      </div>

      <section className="panel" aria-labelledby="new-slot">
        <h2 id="new-slot" style={{ fontSize: 'var(--step-1)' }}>Open a delivery slot</h2>
        {create.isError && <ErrorNote error={create.error} />}
        {create.isSuccess && (
          <div className="notice success" role="status">
            Slot opened: {formatSlot(create.data.starts_at, create.data.ends_at)}, {create.data.capacity} places.
          </div>
        )}
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="field">
            <label htmlFor="slot-start">Starts at</label>
            <input id="slot-start" className="input" type="datetime-local" value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="slot-duration">Length</label>
            <select id="slot-duration" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="slot-capacity">Orders it can take</label>
            <input id="slot-capacity" className="input" type="number" min={1} max={1000} value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))} required />
          </div>
          <div className="field">
            <button className="btn btn-dark" disabled={create.isPending || storeId === ''}>
              {create.isPending ? 'Opening…' : 'Open slot'}
            </button>
          </div>
        </form>
      </section>

      <h2 style={{ fontSize: 'var(--step-1)', marginTop: 28 }}>Next 24 hours</h2>
      {usage.isPending ? (
        <Spinner label="Loading slots" />
      ) : usage.isError ? (
        <ErrorNote error={usage.error} onRetry={() => usage.refetch()} />
      ) : usage.data.length === 0 ? (
        <Empty title="No slots in the next 24 hours">
          <p>Customers can't check out without a slot. Open one above.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Slot</th>
                <th className="num">Booked</th>
                <th style={{ width: '40%' }}>How full</th>
              </tr>
            </thead>
            <tbody>
              {usage.data.map((s) => (
                <tr key={s.id}>
                  <td>{formatSlot(s.starts_at, s.ends_at)}</td>
                  <td className="num">{s.booked} of {s.capacity}</td>
                  <td>
                    <div className={`bar${s.booked >= s.capacity ? ' full' : ''}`} role="img"
                      aria-label={`${s.utilisation_pct}% full`}>
                      <span style={{ width: `${s.utilisation_pct}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ===========================================================================
// SALES: last 7 days per store and day, plus best sellers
// ===========================================================================

export function AdminReportsPage() {
  const [storeId, setStoreId] = useDefaultStore();

  const sales = useQuery({
    queryKey: ['admin', 'sales'],
    queryFn: () => api<SalesRow[]>('/admin/reports/sales'),
  });
  const top = useQuery({
    queryKey: ['admin', 'top', storeId],
    queryFn: () => api<TopProduct[]>(`/admin/reports/top-products?storeId=${storeId}&days=7`),
    enabled: storeId !== '',
  });

  const totals = (sales.data ?? []).reduce(
    (t, r) => ({ orders: t.orders + r.orders, revenue: t.revenue + r.revenue_paise }),
    { orders: 0, revenue: 0 },
  );
  const maxRevenue = Math.max(1, ...(sales.data ?? []).map((r) => r.revenue_paise));

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="muted small">Orders, last 7 days</div>
          <div className="value">{totals.orders}</div>
        </div>
        <div className="stat">
          <div className="muted small">Revenue, last 7 days</div>
          <div className="value">{formatPaise(totals.revenue)}</div>
        </div>
        <div className="stat">
          <div className="muted small">Average order</div>
          <div className="value">{totals.orders ? formatPaise(Math.round(totals.revenue / totals.orders)) : '–'}</div>
        </div>
      </div>
      <p className="muted small">Cancelled orders are not counted.</p>

      <h2 style={{ fontSize: 'var(--step-1)' }}>By store and day</h2>
      {sales.isPending ? (
        <Spinner label="Loading sales" />
      ) : sales.isError ? (
        <ErrorNote error={sales.error} onRetry={() => sales.refetch()} />
      ) : sales.data.length === 0 ? (
        <Empty title="No sales in the last 7 days"><p>Completed orders will show up here.</p></Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Store</th>
                <th className="num">Orders</th>
                <th className="num">Revenue</th>
                <th style={{ width: '30%' }}><span className="visually-hidden">Revenue chart</span></th>
              </tr>
            </thead>
            <tbody>
              {sales.data.map((r) => (
                <tr key={r.store_id + r.day}>
                  <td>{new Date(r.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td>{r.store}</td>
                  <td className="num">{r.orders}</td>
                  <td className="num">{formatPaise(r.revenue_paise)}</td>
                  <td>
                    <div className="bar" aria-hidden="true">
                      <span style={{ width: `${(r.revenue_paise / maxRevenue) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title" style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 'var(--step-1)' }}>Best sellers this week</h2>
        <div style={{ minWidth: 200 }}><StoreSelect value={storeId} onChange={setStoreId} /></div>
      </div>
      {top.isPending ? (
        <Spinner label="Loading best sellers" />
      ) : top.isError ? (
        <ErrorNote error={top.error} />
      ) : top.data.length === 0 ? (
        <Empty title="Nothing sold here this week" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Units sold</th>
                <th className="num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {top.data.map((p) => (
                <tr key={p.product_id}>
                  <td>{p.name}</td>
                  <td className="num">{p.units_sold}</td>
                  <td className="num">{formatPaise(p.revenue_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
