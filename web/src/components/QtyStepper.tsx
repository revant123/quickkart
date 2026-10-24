import { MAX_QTY } from '../features/cart/cartReducer';

export function QtyStepper({
  name,
  quantity,
  onChange,
}: {
  name: string;
  quantity: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="stepper" role="group" aria-label={`Quantity of ${name}`}>
      <button
        type="button"
        onClick={() => onChange(quantity - 1)}
        aria-label={quantity === 1 ? `Remove ${name}` : `One less ${name}`}
      >
        −
      </button>
      <output aria-live="polite">{quantity}</output>
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={quantity >= MAX_QTY}
        aria-label={`One more ${name}`}
      >
        +
      </button>
    </div>
  );
}
