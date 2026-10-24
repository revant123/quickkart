import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { App } from './App';
import { StoreProvider } from './features/store/StoreContext';
import { CartProvider } from './features/cart/CartContext';
import { LiveProvider } from './features/live/LiveProvider';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't retry 4xx errors (asking again won't change "not found")
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <StoreProvider>
          <CartProvider>
            <LiveProvider>
              <App />
            </LiveProvider>
          </CartProvider>
        </StoreProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
