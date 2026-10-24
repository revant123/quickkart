import { Link, useLocation, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import type { Order, OrderStatus } from '../api/types';
import { formatDateTime, formatPaise, formatSlot, STATUS_LABEL } from '../lib/format';
import { Empty, ErrorNote, Spinner } from '../components/Feedback';

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status]}</span>;
}

export function OrdersPage() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api<Order[]>('/orders') });

  return (
    <div className="page medium">
      <h1>Your orders</h1>
      {orders.isPending ? (
        <Spinner label="Loading your orders" />
      ) : orders.isError ? (
        <ErrorNote error={orders.error} onRetry={() => orders.refetch()} />
      ) : orders.data.length === 0 ? (
        <Empty title="No orders yet">
          <p>When you place an order, it shows up here with its delivery slot and status.</p>
          <Link className="btn btn-dark" to="/">Start shopping</Link>
        </Empty>
      ) : (
        <ul className="order-list">
          {orders.data.map((o) => {
            const count = o.items.reduce((n, i) => n + i.quantity, 0);
            return (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className="order-row">
                  <span className="title">Order {o.id}</span>
                  <span className="amount">{formatPaise(o.total_paise)}</span>
                  <span className="muted small">
                    {count} {count === 1 ? 'item' : 'items'} from {o.store_name}. Placed{' '}
                    {formatDateTime(o.created_at)}.
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <StatusBadge status={o.status} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STEPS: OrderStatus[] = ['PLACED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

export function OrderDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const justPlaced = (location.state as { justPlaced?: boolean } | null)?.justPlaced;
  const qc = useQueryClient();

  const order = useQuery({
    queryKey: ['orders', id],
    queryFn: () => api<Order>(`/orders/${id}`),
  });

  const cancel = useMutation({
    mutationFn: () => api<{ status: OrderStatus }>(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  if (order.isPending) return <div className="page medium"><Spinner label="Loading order" /></div>;
  if (order.isError) {
    return (
      <div className="page medium">
        <h1>Order not found</h1>
        <p className="muted">{errorMessage(order.error)}</p>
        <Link to="/orders" className="btn btn-ghost">See all your orders</Link>
      </div>
    );
  }

  const o = order.data;
  const stepIndex = STEPS.indexOf(o.status);
  const canCancel = o.status === 'PLACED' || o.status === 'PACKED';

  return (
    <div className="page medium">
      {justPlaced && o.status === 'PLACED' && (
        <div className="notice success" role="status">
          Order placed. It will arrive between {formatSlot(o.slot_start, o.slot_end)}.
        </div>
      )}

      <div className="admin-head">
        <div>
          <h1 style={{ marginBottom: 4 }}>Order {o.id}</h1>
          <span className="muted">Placed {formatDateTime(o.created_at)} from {o.store_name}</span>
        </div>
        <StatusBadge status={o.status} />
      </div>

      {o.status === 'CANCELLED' ? (
        <div className="notice">This order was cancelled. Nothing will be delivered or charged.</div>
      ) : (
        <ol className="progress" aria-label="Order progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i <= stepIndex ? 'done' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
              {STATUS_LABEL[s]}
            </li>
          ))}
        </ol>
      )}

      <div className="stats">
        <div className="stat">
          <div className="muted small">Delivery slot</div>
          <div style={{ fontWeight: 700 }}>{formatSlot(o.slot_start, o.slot_end)}</div>
        </div>
        <div className="stat">
          <div className="muted small">Address</div>
          <div style={{ fontWeight: 600 }}>{o.address}</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Price</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.productId}>
                <td>
                  {i.name} <span className="muted small">{i.unit}</span>
                </td>
                <td className="num">{i.quantity}</td>
                <td className="num">{formatPaise(i.unitPricePaise)}</td>
                <td className="num">{formatPaise(i.unitPricePaise * i.quantity)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ fontWeight: 800 }}>Total</td>
              <td className="num" style={{ fontWeight: 800 }}>{formatPaise(o.total_paise)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {canCancel && (
        <div style={{ marginTop: 24 }}>
          {cancel.isError && <ErrorNote error={cancel.error} />}
          <button className="btn btn-danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            {cancel.isPending ? 'Cancelling…' : 'Cancel order'}
          </button>
          <p className="muted small" style={{ marginTop: 8 }}>
            You can cancel until the order leaves the store.
          </p>
        </div>
      )}

      <p style={{ marginTop: 28 }}>
        <Link to="/orders">All your orders</Link>
      </p>
    </div>
  );
}
