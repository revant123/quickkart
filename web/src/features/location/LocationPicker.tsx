import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../api/client';
import type { NearestResult } from '../../api/types';
import { useStore, type DeliveryLocation } from '../store/StoreContext';
import { Modal } from '../../components/Modal';

/** Header button: where you are, and which store delivers there. Opens the picker. */
export function LocationButton() {
  const { store, location } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="location-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="where">{location ? location.label : 'Set your location'}</span>
        <span className="which">{store ? `from ${store.name}` : 'Choose a store'} ▾</span>
      </button>
      {open && <LocationDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function LocationDialog({ onClose }: { onClose: () => void }) {
  const { setStoreId, setLocation, storeId } = useStore();
  const qc = useQueryClient();
  const [pincode, setPincode] = useState('');
  const [busy, setBusy] = useState<'gps' | 'pincode' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ found: NearestResult; where: DeliveryLocation } | null>(null);

  const search = async (query: string, where: (r: NearestResult) => DeliveryLocation) => {
    try {
      const found = await api<NearestResult>(`/stores/nearest?${query}`);
      setResult({ found, where: where(found) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const useGps = () => {
    setError('');
    if (!('geolocation' in navigator)) {
      setError('This browser can’t share its location. Enter your pincode instead.');
      return;
    }
    setBusy('gps');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        void search(`lat=${lat}&lng=${lng}`, () => ({ label: 'Your current location', lat, lng, pincode: null }));
      },
      (err) => {
        setBusy(null);
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access was blocked. Allow it in the browser, or enter your pincode.'
            : 'Couldn’t get your location. Enter your pincode instead.',
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const byPincode = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^[1-9][0-9]{5}$/.test(pincode.trim())) {
      setError('Enter a 6-digit pincode, like 160017.');
      return;
    }
    setBusy('pincode');
    void search(`pincode=${pincode.trim()}`, (r) => ({
      label: `${r.point.area}, ${r.point.city}`, lat: r.point.lat, lng: r.point.lng, pincode: r.point.pincode,
    }));
  };

  const choose = (id: number) => {
    if (result) setLocation(result.where);
    setStoreId(id);
    qc.invalidateQueries({ queryKey: ['products'] });
    onClose();
  };

  const delivering = result?.found.stores.filter((s) => s.delivers) ?? [];
  // The nearest few are what matter; with stores in many cities the full list is long
  const shown = result ? result.found.stores.slice(0, Math.max(5, delivering.length)) : [];
  const approximate = result && result.found.point.precise === false;

  return (
    <Modal title="Where should we deliver?" onClose={onClose} labelledBy="location-title">
      <button className="btn btn-dark btn-block" onClick={useGps} disabled={busy !== null}>
        {busy === 'gps' ? 'Finding you…' : 'Use my current location'}
      </button>
      <div className="or"><span>or</span></div>
      <form className="inline-form" onSubmit={byPincode} noValidate>
        <label htmlFor="pincode" className="visually-hidden">Pincode</label>
        <input id="pincode" className="input" inputMode="numeric" maxLength={6} placeholder="Pincode, e.g. 560034"
          value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} />
        <button className="btn btn-ghost" disabled={busy !== null}>{busy === 'pincode' ? 'Finding…' : 'Find stores'}</button>
      </form>
      {error && <div className="notice error" role="alert" style={{ marginTop: 14 }}>{error}</div>}

      {result && (
        <div className="store-results" aria-live="polite">
          <p className="small muted">
            {delivering.length
              ? `${delivering.length === 1 ? 'This store delivers' : 'These stores deliver'} to ${result.where.label}:`
              : `No store delivers to ${result.where.label} yet. Stores deliver within ${result.found.stores[0]?.radius_km ?? 7} km. The nearest:`}
          </p>
          {approximate && (
            <p className="small muted">
              This pincode&rsquo;s position is approximate. For exact distances, use your current location.
            </p>
          )}
          <ul>
            {shown.map((s) => (
              <li key={s.id} className={s.delivers ? '' : 'far'}>
                <div>
                  <strong>{s.name}</strong>
                  <div className="muted small">
                    {s.address} · {s.distance_km.toLocaleString('en-IN')} km {s.delivers ? '' : '(too far to deliver)'}
                  </div>
                </div>
                <button className={`btn btn-sm ${s.delivers ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => choose(Number(s.id))}>
                  {Number(s.id) === storeId ? 'Keep' : s.delivers ? 'Shop here' : 'Browse'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
