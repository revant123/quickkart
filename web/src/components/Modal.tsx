import { useEffect, useRef, type ReactNode } from 'react';

/** A centred dialog over a dimmed page. Escape or the × closes it; focus moves inside. */
export function Modal({
  title, onClose, children, labelledBy = 'modal-title',
}: { title: string; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <div className="modal-head">
          <h2 id={labelledBy}>{title}</h2>
          <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </>
  );
}
