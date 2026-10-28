import { useEffect, useState } from 'react';

// Small UI pieces shared by the booking and admin screens.

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-mist">{label}</span>
      {children}
      {hint && !error && <span className="mt-1.5 block text-xs text-mist">{hint}</span>}
      {error && <span className="mt-1.5 block text-xs text-rose-300">{error}</span>}
    </label>
  );
}

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`card min-w-0 p-5 sm:p-7 ${className}`}>{children}</section>;
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'info' | 'warn' | 'success'; children: React.ReactNode }) {
  const cls = {
    error: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
    info: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
    warn: 'border-dashed border-amber-300/30 bg-amber-300/5 text-amber-100/85',
    success: 'border-aurora/30 bg-aurora/10 text-white',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-2xl border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'green' | 'blue' | 'red' | 'amber' | 'neutral' | 'dim'; children: React.ReactNode }) {
  const cls = {
    green: 'bg-aurora/15 text-aurora',
    blue: 'bg-sky-400/15 text-sky-200',
    red: 'bg-rose-500/15 text-rose-200',
    amber: 'bg-amber-300/15 text-amber-200',
    neutral: 'bg-white/10 text-white/80',
    dim: 'bg-white/5 text-white/40',
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-ink-2 p-6 sm:rounded-3xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Small toast that fades after a few seconds. */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const node = toast ? (
    <div
      role="status"
      className={`fixed left-1/2 top-20 z-[60] max-w-[90vw] -translate-x-1/2 rounded-2xl border px-5 py-2.5 text-sm shadow-xl backdrop-blur ${
        toast.tone === 'error' ? 'border-rose-400/40 bg-rose-950/90 text-rose-100' : 'border-aurora/30 bg-ink-2/95'
      }`}
    >
      {toast.text}
    </div>
  ) : null;

  return {
    node,
    ok: (text: string) => setToast({ text, tone: 'ok' }),
    error: (e: unknown) => setToast({ text: e instanceof Error ? e.message : String(e), tone: 'error' }),
  };
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-mist" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-white/15 border-t-aurora" />
      {label}
    </div>
  );
}

export function Icon({ d, className = 'size-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const icons = {
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  clock: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M5 21h14',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  user: 'M20 21a8 8 0 1 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm18 2-10 7L2 6',
};
