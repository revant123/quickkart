import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Store } from '../../api/types';
import { readStorage, writeStorage } from '../../lib/storage';

type StoreCtx = {
  stores: Store[];
  storeId: number | null;
  store: Store | undefined;
  setStoreId: (id: number) => void;
};

const Ctx = createContext<StoreCtx | null>(null);

/** Which dark store the customer is shopping from. Remembered in this browser. */
export function StoreProvider({ children }: { children: ReactNode }) {
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const [storeId, setStoreIdState] = useState<number | null>(() => readStorage('qk.store', null));
  const stores = storesQuery.data ?? [];

  // Default to the first store, and recover if the remembered one no longer exists
  useEffect(() => {
    if (stores.length && !stores.some((s) => Number(s.id) === storeId)) {
      setStoreIdState(Number(stores[0].id));
    }
  }, [stores, storeId]);

  const setStoreId = (id: number) => {
    setStoreIdState(id);
    writeStorage('qk.store', id);
  };

  return (
    <Ctx.Provider
      value={{ stores, storeId, store: stores.find((s) => Number(s.id) === storeId), setStoreId }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
