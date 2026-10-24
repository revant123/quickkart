import { useEffect, useState } from 'react';

/** Returns `value`, but only after it has stopped changing for `ms` milliseconds.
 *  Used for search: query the API 300 ms after the user stops typing, not on every key. */
export function useDebounce<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
