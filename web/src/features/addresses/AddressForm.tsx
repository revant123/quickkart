import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import type { Address } from '../../api/types';
import { useSaveAddress } from './addresses';

const LABELS = ['Home', 'Work', 'Other'];
const phoneDigits = (v: string) => v.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');

/** Add or edit a saved address. Calls onSaved with the saved address. */
export function AddressForm({
  initial, onSaved, onCancel, submitLabel = 'Save address',
}: { initial?: Address; onSaved: (a: Address) => void; onCancel?: () => void; submitLabel?: string }) {
  const save = useSaveAddress();
  const [label, setLabel] = useState(initial?.label ?? 'Home');
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [line2, setLine2] = useState(initial?.line2 ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [pincode, setPincode] = useState(initial?.pincode ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsNote, setGpsNote] = useState('');
  const [touched, setTouched] = useState(false);

  const errors = {
    line1: line1.trim().length < 3 ? 'Enter your house or flat number and street.' : '',
    city: city.trim().length < 2 ? 'Enter your city.' : '',
    pincode: !/^[1-9][0-9]{5}$/.test(pincode) ? 'Enter a 6-digit pincode.' : '',
    phone: !/^[6-9][0-9]{9}$/.test(phoneDigits(phone)) ? 'Enter a 10-digit mobile number.' : '',
  };
  const show = (k: keyof typeof errors) => (touched ? errors[k] : '');

  // Fill in the city from the pincode, so most people only type the first line
  const lookupPincode = async (value: string) => {
    if (!/^[1-9][0-9]{5}$/.test(value)) return;
    try {
      const p = await api<{ area: string; city: string; precise: boolean }>(`/pincodes/${value}`);
      if (!city.trim()) setCity(p.city);
      if (!line2.trim()) setLine2(p.area);
      if (!p.precise && !gps) setGpsNote('We only know roughly where this pincode is. Use your exact location so the right store can deliver.');
    } catch {
      /* unknown pincode: the server explains when saving */
    }
  };

  const pinpoint = () => {
    if (!('geolocation' in navigator)) return;
    setGpsNote('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGpsNote('Exact location saved. The rider will see a map pin.');
      },
      () => setGpsNote('Couldn’t get your location. The pincode area will be used.'),
      { timeout: 10_000 },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    save.mutate(
      {
        id: initial?.id, label, line1: line1.trim(), line2: line2.trim(), city: city.trim(), pincode,
        phone: phoneDigits(phone), ...(gps ?? {}),
      },
      { onSuccess: onSaved },
    );
  };

  return (
    <form className="address-form" onSubmit={submit} noValidate>
      <div className="chips" role="group" aria-label="Address label">
        {LABELS.map((l) => (
          <button type="button" key={l} className="chip" aria-pressed={label === l} onClick={() => setLabel(l)}>{l}</button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="a-line1">House / flat, street</label>
        <input id="a-line1" className="input" autoComplete="address-line1" value={line1}
          onChange={(e) => setLine1(e.target.value)} aria-invalid={!!show('line1')} />
        {show('line1') && <span className="error">{show('line1')}</span>}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="a-pincode">Pincode</label>
          <input id="a-pincode" className="input" inputMode="numeric" maxLength={6} autoComplete="postal-code"
            value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
            onBlur={(e) => lookupPincode(e.target.value)} aria-invalid={!!show('pincode')} />
          {show('pincode') && <span className="error">{show('pincode')}</span>}
        </div>
        <div className="field">
          <label htmlFor="a-city">City</label>
          <input id="a-city" className="input" autoComplete="address-level2" value={city}
            onChange={(e) => setCity(e.target.value)} aria-invalid={!!show('city')} />
          {show('city') && <span className="error">{show('city')}</span>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="a-line2">Area, landmark <span className="muted">(optional)</span></label>
        <input id="a-line2" className="input" autoComplete="address-line2" value={line2}
          onChange={(e) => setLine2(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="a-phone">Mobile number</label>
        <input id="a-phone" className="input" type="tel" autoComplete="tel-national" placeholder="98765 43210"
          value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!show('phone')}
          aria-describedby="a-phone-hint" />
        {show('phone') ? (
          <span className="error">{show('phone')}</span>
        ) : (
          <span id="a-phone-hint" className="hint">For the rider, and order updates by SMS.</span>
        )}
      </div>
      <p className="small">
        <button type="button" className="link-btn" onClick={pinpoint}>Use my exact location for this address</button>
        {gpsNote && <span className="muted"> {gpsNote}</span>}
      </p>
      {save.isError && <div className="notice error" role="alert">{errorMessage(save.error)}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
