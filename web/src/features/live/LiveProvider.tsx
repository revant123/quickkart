import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { ProductPage, Slot } from '../../api/types';
import { useStore } from '../store/StoreContext';
import { useMe } from '../auth/useAuth';

// ---------------------------------------------------------------------------
// Live updates in the browser.
//
// The server pushes events over Server-Sent Events (see api/src/live.ts). Here
// we open the streams with the browser's EventSource (which reconnects by
// itself) and PATCH TanStack Query's cached data in place, so tiles, slots and
// order pages update without refetching or reloading anything.
// ---------------------------------------------------------------------------

export type LiveStock = { productId: number; in_stock: boolean; low_stock: number | null; price_paise?: number; listed?: boolean };

/** Opens an EventSource while `url` is set; calls handlers[event] with parsed data. */
export function useEventSource(
  url: string | null,
  handlers: Record<string, (data: any) => void>,
  onStatus?: (connected: boolean) => void,
) {
  const ref = useRef(handlers);
  ref.current = handlers; // always call the latest handlers without reconnecting
  useEffect(() => {
    if (!url) return;
    const source = new EventSource(url, { withCredentials: true });
    source.onopen = () => onStatus?.(true);
    source.onerror = () => onStatus?.(false); // EventSource retries automatically
    const listeners = Object.keys(ref.current).map((name) => {
      const fn = (e: MessageEvent) => ref.current[name]?.(JSON.parse(e.data));
      source.addEventListener(name, fn);
      return [name, fn] as const;
    });
    return () => {
      listeners.forEach(([name, fn]) => source.removeEventListener(name, fn));
      source.close();
      onStatus?.(false);
    };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
}

type Ctx = { connected: boolean; stock: Map<number, LiveStock> };
const LiveCtx = createContext<Ctx>({ connected: false, stock: new Map() });

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { storeId } = useStore();
  const me = useMe();
  const [connected, setConnected] = useState(false);
  const [stock, setStock] = useState<Map<number, LiveStock>>(new Map());

  // A new store means a new stream and a fresh picture
  useEffect(() => setStock(new Map()), [storeId]);

  useEventSource(
    storeId ? `/api/stores/${storeId}/live` : null,
    {
      stock: (items: LiveStock[]) => {
        const byId = new Map(items.map((i) => [i.productId, i]));
        // Remember the latest state (the cart drawer and checkout read this)
        setStock((prev) => {
          const next = new Map(prev);
          items.forEach((i) => next.set(i.productId, i));
          return next;
        });
        // Patch every cached product page for this store
        qc.setQueriesData<InfiniteData<ProductPage>>({ queryKey: ['products', storeId] }, (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items
                .filter((p) => byId.get(Number(p.id))?.listed !== false) // hidden by staff
                .map((p) => {
                  const u = byId.get(Number(p.id));
                  return u
                    ? { ...p, in_stock: u.in_stock, low_stock: u.low_stock, price_paise: u.price_paise ?? p.price_paise }
                    : p;
                }),
            })),
          },
        );
      },
      slot: ({ slotId, free }: { slotId: number; free: number }) => {
        let known = false;
        qc.setQueryData<Slot[]>(['slots', storeId], (slots) => {
          if (!slots) return slots;
          known = slots.some((s) => Number(s.id) === slotId);
          return slots
            .map((s) => (Number(s.id) === slotId ? { ...s, free } : s))
            .filter((s) => s.free > 0); // a full slot disappears from the list
        });
        if (!known && free > 0) qc.invalidateQueries({ queryKey: ['slots', storeId] }); // a new slot opened
      },
    },
    setConnected,
  );

  // My orders: status changes (packed, out for delivery...) refresh order pages
  useEventSource(me.data ? '/api/orders/live' : null, {
    order: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });

  return <LiveCtx.Provider value={{ connected, stock }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);
