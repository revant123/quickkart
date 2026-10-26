import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Slot } from '../api/types';
import { formatDay, formatTime } from '../lib/format';
import { useStore } from '../features/store/StoreContext';
import { useLive } from '../features/live/LiveProvider';

/**
 * The headline of the shop, styled as a delivery ticket: when your order would arrive
 * if you ordered now, from real slot data. The one bold element on the page.
 */
export function DeliveryBand() {
  const { storeId, store } = useStore();
  const slots = useQuery({
    queryKey: ['slots', storeId],
    queryFn: () => api<Slot[]>(`/stores/${storeId}/slots`),
    enabled: storeId !== null,
    refetchInterval: 60_000, // slots fill up; keep the promise honest
  });

  const next = slots.data?.[0];
  const { connected } = useLive();

  return (
    <section className="eta-ticket" aria-label="Next delivery">
      <div className="eta-main">
        {slots.isPending ? (
          <p className="eta-lead">Checking delivery slots…</p>
        ) : next ? (
          <>
            <p className="eta-lead">Order now, it arrives from</p>
            <p className="eta-time">
              {formatTime(next.starts_at)}
              <span className="eta-day">{formatDay(next.starts_at)}</span>
            </p>
          </>
        ) : (
          <>
            <p className="eta-lead">No delivery slots open right now</p>
            <p className="eta-sub">Store staff open new slots through the admin area.</p>
          </>
        )}
      </div>
      <div className="eta-side">
        {store && (
          <p className="eta-store">
            <strong>{store.name}</strong>
            <span>{store.address ?? store.city}</span>
          </p>
        )}
        {next && (
          <p className="eta-places">
            {next.free} {next.free === 1 ? 'place' : 'places'} left in this slot
          </p>
        )}
        {connected && (
          <span className="live-pill" title="Stock and slots update as people order">
            <span className="live-dot" aria-hidden="true" /> Live
          </span>
        )}
      </div>
    </section>
  );
}
