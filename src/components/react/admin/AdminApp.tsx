import { useEffect, useState } from 'react';
import type { Backend } from '../../../lib/booking/api';
import type { Booking, Role, Settings, StaffSession } from '../../../lib/booking/types';
import { useBackend, useSettings } from '../booking/hooks';
import { Alert, Field, Spinner, useToast } from '../ui';
import ActivityTab from './ActivityTab';
import BookingSheet from './BookingSheet';
import BookingsTab from './BookingsTab';
import ClosuresTab from './ClosuresTab';
import CustomersTab from './CustomersTab';
import DiscountsTab from './DiscountsTab';
import ReportsTab from './ReportsTab';
import RequestsTab from './RequestsTab';
import Schedule from './Schedule';
import SettingsTab from './SettingsTab';
import type { AdminCtx } from './shared';

type Tab = 'schedule' | 'bookings' | 'requests' | 'customers' | 'reports' | 'closures' | 'discounts' | 'settings' | 'activity';

const TABS: { id: Tab; label: string; owner?: boolean }[] = [
  { id: 'schedule', label: 'Schedule' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'requests', label: 'Requests' },
  { id: 'customers', label: 'Customers' },
  { id: 'reports', label: 'Reports' },
  { id: 'closures', label: 'Closures' },
  { id: 'discounts', label: 'Discounts', owner: true },
  { id: 'settings', label: 'Settings', owner: true },
  { id: 'activity', label: 'Activity' },
];

export default function AdminApp() {
  const backend = useBackend();
  const settings = useSettings();
  const [session, setSession] = useState<StaffSession | null | undefined>(undefined);

  useEffect(() => {
    backend?.getSession().then(setSession);
  }, [backend]);

  if (!backend || !settings || session === undefined) return <Spinner />;
  if (!session) return <Login backend={backend} onSignedIn={setSession} />;
  return <Admin backend={backend} settings={settings} session={session} onSignOut={() => backend.signOut().then(() => setSession(null))} />;
}

function Admin({ backend, settings, session, onSignOut }: { backend: Backend; settings: Settings; session: StaffSession; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>(() => (window.location.hash.slice(1) as Tab) || 'schedule');
  const [open, setOpen] = useState<Booking | null>(null);
  const toast = useToast();
  const isOwner = session.role === 'owner';
  const ctx: AdminCtx = { backend, settings, session, toast, isOwner, openBooking: setOpen };
  const tabs = TABS.filter((t) => !t.owner || isOwner);

  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  // Links like /admin#requests switch tabs.
  useEffect(() => {
    const onHash = () => {
      const t = window.location.hash.slice(1) as Tab;
      if (TABS.some((x) => x.id === t)) setTab(t);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Admin</h1>
          <p className="text-sm text-mist">
            {session.name} · <span className="capitalize">{session.role}</span>
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      {backend.mode === 'demo' && (
        <div className="mb-6">
          <Alert tone="warn">
            <strong className="text-amber-100">Demo mode.</strong> Data is stored only in this browser. Connect Supabase (see
            supabase/README.md) for real staff logins and a shared database.
          </Alert>
        </div>
      )}

      <nav className="-mx-5 mb-6 overflow-x-auto px-5" aria-label="Admin sections">
        <div className="flex w-max gap-1 rounded-2xl border border-line bg-ink-2/70 p-1 text-sm">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`rounded-xl px-4 py-2 transition-colors ${tab === t.id ? 'bg-aurora font-medium text-ink' : 'text-mist hover:bg-white/5 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'schedule' && <Schedule ctx={ctx} />}
      {tab === 'bookings' && <BookingsTab ctx={ctx} />}
      {tab === 'requests' && <RequestsTab ctx={ctx} />}
      {tab === 'customers' && <CustomersTab ctx={ctx} />}
      {tab === 'reports' && <ReportsTab ctx={ctx} />}
      {tab === 'closures' && <ClosuresTab ctx={ctx} />}
      {tab === 'discounts' && isOwner && <DiscountsTab ctx={ctx} />}
      {tab === 'settings' && isOwner && <SettingsTab ctx={ctx} />}
      {tab === 'activity' && <ActivityTab ctx={ctx} />}

      {backend.resetDemo && (
        <div className="mt-12 flex justify-end">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await backend.resetDemo!();
              toast.ok('Demo data reset');
            }}
          >
            Reset demo data
          </button>
        </div>
      )}

      {open && <BookingSheet ctx={ctx} bookingId={open.id} initial={open} onClose={() => setOpen(null)} />}
      {toast.node}
    </div>
  );
}

function Login({ backend, onSignedIn }: { backend: Backend; onSignedIn: (s: StaffSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const demo = async (role: Role) => onSignedIn(await backend.demoSignIn!(role));

  return (
    <div className="mx-auto max-w-sm py-10">
      <div className="card p-7">
        <h1 className="font-display text-2xl font-semibold">Staff sign in</h1>
        {backend.mode === 'demo' ? (
          <>
            <p className="mt-2 text-sm text-mist">
              Demo mode has no passwords. Pick a role to see what each can do. Staff can't change prices, settings or discounts, or give
              refunds.
            </p>
            <div className="mt-6 space-y-2">
              <button type="button" className="btn btn-primary btn-block" onClick={() => demo('owner')}>
                Continue as Owner
              </button>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => demo('staff')}>
                Continue as Staff
              </button>
            </div>
          </>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                onSignedIn(await backend.signIn(email, password));
              } catch (err) {
                setError((err as Error).message);
              }
              setBusy(false);
            }}
          >
            <Field label="Email">
              <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <Alert>{error}</Alert>}
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
