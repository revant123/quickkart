import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError, errorMessage } from '../api/client';
import { useLogin, useRegister } from '../features/auth/useAuth';

// CONTROLLED forms: React state holds each input's value, so validating, disabling
// the button while sending, and showing server errors are all straightforward.
// Client checks mirror the server's rules for fast feedback; the server still checks.

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function useReturnTo() {
  const location = useLocation();
  return (location.state as { from?: string } | null)?.from ?? '/';
}

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const emailError = touched && !emailOk(email) ? 'Enter an email like name@example.com.' : '';
  const passwordError = touched && !password ? 'Enter your password.' : '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!emailOk(email) || !password) return;
    login.mutate({ email, password }, { onSuccess: () => navigate(returnTo, { replace: true }) });
  };

  return (
    <div className="page narrow">
      <div className="auth-card">
        <h1>Log in</h1>
        <p className="muted">Log in to check out and see your orders.</p>

        {login.isError && (
          <div className="notice error" role="alert">
            {errorMessage(login.error)}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              aria-describedby={emailError ? 'email-error' : undefined}
            />
            {emailError && <span id="email-error" className="error">{emailError}</span>}
          </div>
          <div className="field">
            <div className="label-row">
              <label htmlFor="password">Password</label>
              <Link to="/forgot-password" className="small">Forgot password?</Link>
            </div>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!passwordError}
            />
            {passwordError && <span className="error">{passwordError}</span>}
          </div>
          <button className="btn btn-primary btn-block" disabled={login.isPending}>
            {login.isPending ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="muted small" style={{ marginTop: 16 }}>
          New to QuickKart?{' '}
          <Link to="/register" state={{ from: returnTo }}>
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const returnTo = useReturnTo();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const errors = {
    name: touched && !name.trim() ? 'Enter your name.' : '',
    email: touched && !emailOk(email) ? 'Enter an email like name@example.com.' : '',
    password: touched && password.length < 8 ? 'Use at least 8 characters.' : '',
  };
  const valid = name.trim() && emailOk(email) && password.length >= 8;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    register.mutate(
      { name: name.trim(), email, password },
      { onSuccess: () => navigate(returnTo, { replace: true, state: { registered: true } }) },
    );
  };

  const taken = register.error instanceof ApiError && register.error.code === 'email_taken';

  return (
    <div className="page narrow">
      <div className="auth-card">
        <h1>Create an account</h1>
        <p className="muted">You need an account to place orders.</p>

        {register.isError && (
          <div className="notice error" role="alert">
            {errorMessage(register.error)}
            {taken && (
              <div className="actions">
                <Link className="btn btn-ghost btn-sm" to="/login" state={{ from: returnTo }}>
                  Log in instead
                </Link>
              </div>
            )}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" className="input" autoComplete="name" value={name}
              onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
            {errors.name && <span className="error">{errors.name}</span>}
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
            {errors.email && <span className="error">{errors.email}</span>}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errors.password} aria-describedby="password-hint" />
            {errors.password ? (
              <span className="error">{errors.password}</span>
            ) : (
              <span id="password-hint" className="hint">At least 8 characters.</span>
            )}
          </div>
          <button className="btn btn-primary btn-block" disabled={register.isPending}>
            {register.isPending ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="muted small" style={{ marginTop: 16 }}>
          Already have an account? <Link to="/login" state={{ from: returnTo }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
