import type { ReactNode } from 'react';
import { errorMessage } from '../api/client';

// Every screen that fetches data has four states: loading, error, empty, success.
// These three components cover the first three, so each page only writes "success".

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      {errorMessage(error)}
      {onRetry && (
        <div className="actions">
          <button className="btn btn-ghost btn-sm" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
