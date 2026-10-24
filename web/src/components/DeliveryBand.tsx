import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Slot } from '../api/types';
import { formatDay, formatTime } from '../lib/format';
import { useStore } from '../features/store/StoreContext';
import { useLive } from '../features/live/LiveProvider';

/** The headline of the shop: when the next free delivery slot is, from real slot data. */
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
    <section className="delivery-band" aria-label="Next delivery">
      <div className="container">
        {slots.isPending ? (
          <span className="lead">Checking delivery slots…</span>
        ) : next ? (
          <>
            <span className="lead">Order now, arrives from</span>
            <span className="time">
              {formatTime(next.starts_at)} {formatDay(next.starts_at)}
            </span>
            <span className="detail">
              {store?.name}, {store?.city}. {next.free} {next.free === 1 ? 'place' : 'places'} left in this slot.
            </span>
            {connected && (
              <span className="live-pill" title="Stock and slots update as people order">
                <span className="live-dot" aria-hidden="true" /> Live
              </span>
            )}
          </>
        ) : (
          <>
            <span className="lead">No delivery slots open right now</span>
            <span className="detail">Store staff add new slots through the admin area.</span>
          </>
        )}
      </div>
    </section>
  );
}
