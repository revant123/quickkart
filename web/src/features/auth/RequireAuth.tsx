import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe } from './useAuth';
import { Spinner } from '../../components/Feedback';

/**
 * Wraps pages that need a logged-in user (and optionally an admin).
 * This is for convenience only: the SERVER is the real gatekeeper. Hiding a page
 * here does not secure anything; the API returns 401/403 regardless.
 */
export function RequireAuth({
  children, admin = false, rider = false,
}: { children: ReactNode; admin?: boolean; rider?: boolean }) {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) return <Spinner label="Checking your account" />;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin && me.data.role !== 'admin') {
    return (
      <div className="page narrow">
        <h1>Admins only</h1>
        <p className="muted">
          This area is for store staff. Your account ({me.data.email}) is a customer account.
        </p>
      </div>
    );
  }
  if (rider && me.data.role !== 'rider') {
    return (
      <div className="page narrow">
        <h1>Riders only</h1>
        <p className="muted">This page is for delivery riders. Ask a store admin to add you as a rider.</p>
      </div>
    );
  }
  return <>{children}</>;
}
