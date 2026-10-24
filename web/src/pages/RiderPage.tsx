import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../api/client';
import type { RiderBoard, RiderOrder } from '../api/types';
import { formatPaise, formatSlot } from '../lib/format';
import { useEventSource } from '../features/live/LiveProvider';
import { Empty, ErrorNote, Spinner } from '../components/Feedback';

// The delivery rider's screen, designed for a phone: big buttons, one column.
// The SERVER decides who gets an order (one conditional UPDATE); this page just
// shows the result, so two riders tapping together can't both get it.

const mapsLink = (o: RiderOrder) =>
  o.delivery_lat != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${o.delivery_lat},${o.delivery_lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`;

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

export function RiderPage() {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const [notice, setNotice] = useState('');
  const board = useQuery({
    queryKey: ['rider'],
    queryFn: () => api<RiderBoard>('/rider/orders'),
    refetchInterval: 60_000, // safety net; live events refresh it at once
  });
  useEventSource('/api/rider/live', { order: () => qc.invalidateQueries({ queryKey: ['rider'] }) }, setLive);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pickup' | 'deliver' }) =>
      api(`/rider/orders/${id}/${action}`, { method: 'POST' }),
    onSuccess: (_d, v) => setNotice(v.action === 'pickup' ? `Order ${v.id} is yours. Ride safe.` : `Order ${v.id} delivered.`),
    onError: (e) => setNotice(e instanceof ApiError && e.code === 'already_taken' ? errorMessage(e) : ''),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rider'] }),
  });

  if (board.isPending) return <div className="page medium"><Spinner label="Loading deliveries" /></div>;
  if (board.isError) return <div className="page medium"><ErrorNote error={board.error} onRetry={() => board.refetch()} /></div>;
  const { store, ready, mine } = board.data;

  return (
    <div className="page medium rider">
      <div className="admin-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Deliveries</h1>
          <span className="muted">{store?.name}, {store?.address}</span>
        </div>
        {live && (
          <span className="live-pill dark" title="New packed orders appear by themselves">
            <span className="live-dot" aria-hidden="true" /> Live
          </span>
        )}
      </div>
      {notice && <div className="notice success" role="status">{notice}</div>}
      {act.isError && !(act.error instanceof ApiError && act.error.code === 'already_taken') && <ErrorNote error={act.error} />}

      <h2>On your bike ({mine.length})</h2>
      {mine.length === 0 ? (
        <p className="muted">Nothing yet. Pick up a packed order below.</p>
      ) : (
        <ul className="rider-list">
          {mine.map((o) => (
            <li key={o.id} className="rider-card mine">
              <div className="rider-top">
                <strong>Order {o.id}</strong>
                <span className={`pay-tag ${o.payment_method === 'cod' ? 'cash' : 'paid'}`}>
                  {o.payment_method === 'cod' ? `Collect ${formatPaise(o.total_paise)} cash` : 'Paid online'}
                </span>
              </div>
              <div>{o.customer_name}: {o.address}</div>
              <div className="muted small">{items(o.item_count)} · due {formatSlot(o.slot_start, o.slot_end)}</div>
              <div className="rider-actions">
                <a className="btn btn-ghost" href={mapsLink(o)} target="_blank" rel="noreferrer">Directions</a>
                {o.phone && <a className="btn btn-ghost" href={`tel:+91${o.phone}`}>Call</a>}
                <button className="btn btn-primary" disabled={act.isPending}
                  onClick={() => act.mutate({ id: o.id, action: 'deliver' })}>
                  {o.payment_method === 'cod' ? 'Cash collected, delivered' : 'Delivered'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ marginTop: 28 }}>Ready for pickup ({ready.length})</h2>
      {ready.length === 0 ? (
        <Empty title="No packed orders right now">
          <p>When the store packs an order, it appears here by itself.</p>
        </Empty>
      ) : (
        <ul className="rider-list">
          {ready.map((o) => (
            <li key={o.id} className="rider-card">
              <div className="rider-top">
                <strong>Order {o.id}</strong>
                <span className="muted small">due {formatSlot(o.slot_start, o.slot_end)}</span>
              </div>
              <div>{o.address}</div>
              <div className="muted small">
                {items(o.item_count)} · {o.payment_method === 'cod' ? `cash ${formatPaise(o.total_paise)}` : 'paid online'}
              </div>
              <div className="rider-actions">
                <button className="btn btn-dark" disabled={act.isPending}
                  onClick={() => act.mutate({ id: o.id, action: 'pickup' })}>
                  Pick up
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
