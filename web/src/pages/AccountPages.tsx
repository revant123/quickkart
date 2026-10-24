import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api/client';
import type { Address, User } from '../api/types';
import { useMe } from '../features/auth/useAuth';
import { formatAddress, useAddresses, useDeleteAddress, useSaveAddress } from '../features/addresses/addresses';
import { AddressForm } from '../features/addresses/AddressForm';
import { ErrorNote, Spinner } from '../components/Feedback';

/** "Confirm your email" reminder with a resend button. Shown on Account and Checkout. */
export function VerifyEmailNotice({ user }: { user: User }) {
  const resend = useMutation({ mutationFn: () => api('/auth/resend-verification', { method: 'POST' }) });
  if (user.email_verified) return null;
  return (
    <div className="notice" role="status">
      <strong>Confirm your email to start ordering.</strong> We sent a link to {user.email}.
      <div className="actions">
        <button className="btn btn-ghost btn-sm" onClick={() => resend.mutate()} disabled={resend.isPending || resend.isSuccess}>
          {resend.isSuccess ? 'Sent. Check your inbox' : resend.isPending ? 'Sending…' : 'Send the link again'}
        </button>
      </div>
      {resend.isError && <p className="error small">{errorMessage(resend.error)}</p>}
    </div>
  );
}

export function AccountPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const addresses = useAddresses();
  const del = useDeleteAddress();
  const save = useSaveAddress();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);

  const logoutAll = useMutation({
    mutationFn: () => api('/auth/logout-all', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      navigate('/login');
    },
  });

  if (!me.data) return null;
  const user = me.data;

  return (
    <div className="page medium">
      <h1>Your account</h1>
      <VerifyEmailNotice user={user} />

      <section className="panel">
        <div className="section-title"><h2>Profile</h2></div>
        <dl className="facts">
          <dt>Name</dt><dd>{user.name}</dd>
          <dt>Email</dt>
          <dd>
            {user.email}{' '}
            {user.email_verified ? <span className="badge DELIVERED">Confirmed</span> : <span className="badge PLACED">Not confirmed</span>}
          </dd>
          {user.role !== 'customer' && (<><dt>Role</dt><dd style={{ textTransform: 'capitalize' }}>{user.role}</dd></>)}
        </dl>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Saved addresses</h2>
          {editing === null && (addresses.data?.length ?? 0) < 10 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing('new')}>Add address</button>
          )}
        </div>
        {editing !== null ? (
          <AddressForm
            initial={editing === 'new' ? undefined : editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        ) : addresses.isPending ? (
          <Spinner label="Loading addresses" />
        ) : addresses.isError ? (
          <ErrorNote error={addresses.error} onRetry={() => addresses.refetch()} />
        ) : addresses.data.length === 0 ? (
          <p className="muted">No saved addresses yet. Add one here or at checkout.</p>
        ) : (
          <ul className="address-list">
            {addresses.data.map((a) => (
              <li key={a.id}>
                <div>
                  <strong>{a.label}</strong> {a.is_default && <span className="badge">Default</span>}
                  <div>{formatAddress(a)}</div>
                  <div className="muted small">{a.phone}</div>
                </div>
                <div className="row-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(a)}>Edit</button>
                  {!a.is_default && (
                    <button className="btn btn-sm btn-ghost" disabled={save.isPending}
                      onClick={() => save.mutate({ ...a, line2: a.line2 ?? undefined, isDefault: true })}>
                      Make default
                    </button>
                  )}
                  <button className="btn btn-sm btn-ghost" disabled={del.isPending} onClick={() => del.mutate(a.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {del.isError && <ErrorNote error={del.error} />}
      </section>

      <section className="panel">
        <div className="section-title"><h2>Security</h2></div>
        <p className="muted small">Lost a phone, or logged in on a shared computer? This logs you out everywhere, including here.</p>
        <button className="btn btn-ghost" onClick={() => logoutAll.mutate()} disabled={logoutAll.isPending}>
          Log out of all devices
        </button>
      </section>
    </div>
  );
}

/** Opened from the email link: /verify-email?token=... */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const qc = useQueryClient();
  const verify = useMutation({
    mutationFn: () => api<User>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  // Run once, even though React's development mode mounts components twice
  const started = useRef(false);
  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      verify.mutate();
    }
  }, [token, verify]);

  return (
    <div className="page narrow">
      <div className="auth-card">
        <h1>Confirm your email</h1>
        {!token ? (
          <p className="muted">This link is missing its code. Open the link from the email again.</p>
        ) : verify.isPending || verify.isIdle ? (
          <Spinner label="Confirming" />
        ) : verify.isError ? (
          <>
            <div className="notice error" role="alert">{errorMessage(verify.error)}</div>
            <Link className="btn btn-ghost" to="/account">Send a new link from your account</Link>
          </>
        ) : (
          <>
            <div className="notice success" role="status">Thanks, {verify.data.name}. Your email is confirmed.</div>
            <Link className="btn btn-primary" to="/">Start shopping</Link>
          </>
        )}
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const send = useMutation({
    mutationFn: () => api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: email.trim() }) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (emailOk) send.mutate();
  };
  return (
    <div className="page narrow">
      <div className="auth-card">
        <h1>Reset your password</h1>
        {send.isSuccess ? (
          <div className="notice success" role="status">
            If there’s an account for {email.trim()}, we’ve sent it a link to choose a new password.
            The link works for 1 hour.
          </div>
        ) : (
          <>
            <p className="muted">Enter your account’s email and we’ll send you a link.</p>
            {send.isError && <div className="notice error" role="alert">{errorMessage(send.error)}</div>}
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} aria-invalid={touched && !emailOk} />
                {touched && !emailOk && <span className="error">Enter an email like name@example.com.</span>}
              </div>
              <button className="btn btn-primary btn-block" disabled={send.isPending}>
                {send.isPending ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}
        <p className="muted small" style={{ marginTop: 16 }}><Link to="/login">Back to log in</Link></p>
      </div>
    </div>
  );
}

/** Opened from the email link: /reset-password?token=... */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: () => api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
    onSuccess: () => qc.setQueryData(['me'], null), // every session was logged out
  });
  const error = touched && password.length < 8 ? 'Use at least 8 characters.' : '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (password.length >= 8) reset.mutate();
  };
  return (
    <div className="page narrow">
      <div className="auth-card">
        <h1>Choose a new password</h1>
        {reset.isSuccess ? (
          <>
            <div className="notice success" role="status">
              Password changed. For safety, you’ve been logged out on every device.
            </div>
            <Link className="btn btn-primary" to="/login">Log in</Link>
          </>
        ) : (
          <>
            {reset.isError && (
              <div className="notice error" role="alert">
                {errorMessage(reset.error)} <Link to="/forgot-password">Get a new link</Link>
              </div>
            )}
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="password">New password</label>
                <input id="password" className="input" type="password" autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
                {error ? <span className="error">{error}</span> : <span className="hint">At least 8 characters.</span>}
              </div>
              <button className="btn btn-primary btn-block" disabled={reset.isPending || !token}>
                {reset.isPending ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
