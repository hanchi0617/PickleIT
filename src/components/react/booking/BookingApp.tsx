import { useEffect, useMemo, useRef, useState } from 'react';
import { booking as cfg } from '../../../config/site';
import * as store from '../../../lib/booking/store';
import { SlotTakenError, type Booking, type DateKey, type Guest, type Slot } from '../../../lib/booking/types';
import {
  describeSlots,
  formatDate,
  formatMoney,
  priceFor,
  slotKey,
  slotStates,
  todayKey,
} from '../../../lib/booking/utils';
import DayGrid, { Legend } from './DayGrid';
import MonthCalendar from './MonthCalendar';
import { useDay, useNow } from './hooks';

type Step = 'pick' | 'details' | 'checkout' | 'done';

export default function BookingApp() {
  const [date, setDate] = useState<DateKey>(todayKey);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('pick');
  const [guest, setGuest] = useState<Guest>({ name: '', phone: '', email: '' });
  const [hold, setHold] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightCourt, setHighlightCourt] = useState<string | null>(null);
  const { data } = useDay(date);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const court = new URLSearchParams(window.location.search).get('court');
    if (court && cfg.courts.some((c) => c.id === court)) setHighlightCourt(court);
  }, []);

  const states = useMemo(
    () => slotStates(date, data?.bookings ?? [], data?.blocks ?? []),
    [date, data],
  );

  // If someone else takes a slot we had selected, drop it and say so.
  useEffect(() => {
    if (step !== 'pick' && step !== 'details') return;
    const lost = [...selected].filter((k) => states.get(k)?.kind !== 'open');
    if (lost.length) {
      setSelected((s) => new Set([...s].filter((k) => !lost.includes(k))));
      setError('A slot you picked was just booked by someone else, so we removed it.');
      if (step === 'details' && lost.length === selected.size) setStep('pick');
    }
  }, [states]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots: Slot[] = useMemo(
    () =>
      [...selected].map((k) => {
        const [courtId, hour] = k.split('@');
        return { courtId: courtId as Slot['courtId'], hour: Number(hour) };
      }),
    [selected],
  );
  const total = priceFor(slots);

  const toggle = (courtId: string, hour: number) => {
    setError(null);
    const k = slotKey(courtId, hour);
    setSelected((s) => {
      const next = new Set(s);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const changeDate = (d: DateKey) => {
    setDate(d);
    setSelected(new Set());
    setError(null);
  };

  const goTo = (s: Step) => {
    setStep(s);
    // Wait for the new step to render before scrolling to it.
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const startCheckout = async () => {
    setError(null);
    try {
      const h = await store.createHold(date, slots, {
        name: guest.name.trim(),
        phone: guest.phone.trim(),
        email: guest.email.trim(),
      });
      setHold(h);
      setStep('checkout');
    } catch (e) {
      if (e instanceof SlotTakenError) {
        const taken = new Set(e.slots.map((s) => slotKey(s.courtId, s.hour)));
        setSelected((s) => new Set([...s].filter((k) => !taken.has(k))));
        goTo('pick');
      }
      setError((e as Error).message);
    }
  };

  const reset = () => {
    setSelected(new Set());
    setHold(null);
    setError(null);
    goTo('pick');
  };

  return (
    <div ref={topRef} className="scroll-mt-24">
      <Stepper step={step} />

      {error && (
        <div role="alert" className="mb-6 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {step === 'pick' && (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <Panel>
            <MonthCalendar value={date} onChange={changeDate} />
          </Panel>

          <Panel>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-mist">Availability for</p>
                <p className="font-display text-2xl font-semibold">
                  {formatDate(date, { weekday: 'long', month: 'long' })}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-xs text-mist">
                <span className="size-1.5 animate-pulse rounded-full bg-aurora" /> Live
              </span>
            </div>
            <DayGrid
              states={states}
              selected={selected}
              highlightCourt={highlightCourt}
              onCellClick={(c, h, st) => (st.kind === 'open' || selected.has(slotKey(c, h))) && toggle(c, h)}
            />
            <div className="mt-5">
              <Legend />
            </div>
          </Panel>
        </div>
      )}

      {step === 'details' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Panel>
            <GuestForm
              guest={guest}
              onChange={setGuest}
              onBack={() => goTo('pick')}
              onSubmit={startCheckout}
            />
          </Panel>
          <Panel>
            <Summary date={date} slots={slots} total={total} />
          </Panel>
        </div>
      )}

      {step === 'checkout' && hold && (
        <Checkout
          hold={hold}
          onPaid={(b) => {
            setHold(b);
            setSelected(new Set());
            goTo('done');
          }}
          onCancel={async () => {
            await store.releaseHold(hold.id);
            setHold(null);
            goTo('details');
          }}
          onExpired={(msg) => {
            setHold(null);
            setError(msg);
            goTo('pick');
          }}
        />
      )}

      {step === 'done' && hold && <Confirmation booking={hold} onAgain={reset} />}

      {step === 'pick' && (
        <SelectionBar
          count={slots.length}
          total={total}
          lines={describeSlots(slots)}
          onClear={() => setSelected(new Set())}
          onNext={() => goTo('details')}
        />
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-3xl border border-line bg-ink-2/80 p-5 backdrop-blur-xl sm:p-7">{children}</section>;
}

function Stepper({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ['pick', 'Pick a slot'],
    ['details', 'Your details'],
    ['checkout', 'Payment'],
    ['done', 'Confirmed'],
  ];
  const idx = steps.findIndex(([s]) => s === step);
  return (
    <ol className="mb-8 flex items-center gap-2 text-xs sm:text-sm">
      {steps.map(([s, label], i) => (
        <li key={s} className="flex flex-1 items-center gap-2">
          <span
            className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition ${
              i < idx ? 'bg-aurora/20 text-aurora' : i === idx ? 'bg-aurora text-ink' : 'border border-line text-mist'
            }`}
          >
            {i < idx ? '✓' : i + 1}
          </span>
          <span className={`hidden sm:inline ${i === idx ? 'text-white' : 'text-mist'}`}>{label}</span>
          {i < steps.length - 1 && <span className={`h-px flex-1 ${i < idx ? 'bg-aurora/40' : 'bg-line'}`} />}
        </li>
      ))}
    </ol>
  );
}

function SelectionBar({
  count,
  total,
  lines,
  onClear,
  onNext,
}: {
  count: number;
  total: number;
  lines: string[];
  onClear: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 px-4 pb-4 transition-transform duration-300 ${count ? 'translate-y-0' : 'translate-y-[120%]'}`}
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      aria-hidden={!count}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-4 rounded-2xl border border-aurora/30 bg-ink-2/95 p-3 pl-5 shadow-[0_10px_60px_rgb(0_0_0/0.6)] backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">
            {formatMoney(total)}{' '}
            <span className="text-sm font-normal text-mist">
              · {count} hour{count === 1 ? '' : 's'}
            </span>
          </p>
          <p className="truncate text-xs text-mist">{lines.join(', ')}</p>
        </div>
        <button type="button" onClick={onClear} className="hidden text-sm text-mist hover:text-white sm:block" tabIndex={count ? 0 : -1}>
          Clear
        </button>
        <button
          type="button"
          onClick={onNext}
          tabIndex={count ? 0 : -1}
          className="rounded-xl bg-aurora px-5 py-3 font-medium text-ink transition hover:shadow-[0_0_30px_rgb(124_255_103/0.5)]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function Summary({ date, slots, total }: { date: DateKey; slots: Slot[]; total: number }) {
  return (
    <div>
      <p className="text-sm text-mist">Your booking</p>
      <p className="mt-1 font-display text-xl font-semibold">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
      <ul className="mt-4 space-y-2 text-sm">
        {describeSlots(slots).map((l) => (
          <li key={l} className="rounded-xl border border-line px-3 py-2">{l}</li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-sm">
        <span className="text-mist">
          {slots.length} × {formatMoney(cfg.pricePerHour)}
        </span>
        <span className="font-display text-2xl font-semibold">{formatMoney(total)}</span>
      </div>
    </div>
  );
}

const PHONE_RE = /^[+\d][\d\s()-]{6,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function GuestForm({
  guest,
  onChange,
  onBack,
  onSubmit,
}: {
  guest: Guest;
  onChange: (g: Guest) => void;
  onBack: () => void;
  onSubmit: () => Promise<void>;
}) {
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const errors = {
    name: guest.name.trim().length < 2 ? 'Please enter your name.' : '',
    phone: !PHONE_RE.test(guest.phone.trim()) ? 'Please enter a valid mobile number.' : '',
    email: !EMAIL_RE.test(guest.email.trim()) ? 'Please enter a valid email.' : '',
  };
  const valid = !errors.name && !errors.phone && !errors.email;

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid || busy) return;
        setBusy(true);
        await onSubmit();
        setBusy(false);
      }}
    >
      <h2 className="font-display text-2xl font-semibold">Your details</h2>
      <p className="mt-1 text-sm text-mist">No account needed. We'll send your confirmation here.</p>

      <div className="mt-6 space-y-4">
        <Field label="Full name" error={touched ? errors.name : ''}>
          <input
            autoComplete="name"
            value={guest.name}
            onChange={(e) => onChange({ ...guest, name: e.target.value })}
            className={inputCls}
            placeholder="Juan Dela Cruz"
          />
        </Field>
        <Field label="Mobile number" error={touched ? errors.phone : ''}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={guest.phone}
            onChange={(e) => onChange({ ...guest, phone: e.target.value })}
            className={inputCls}
            placeholder="0917 123 4567"
          />
        </Field>
        <Field label="Email" error={touched ? errors.email : ''}>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={guest.email}
            onChange={(e) => onChange({ ...guest, email: e.target.value })}
            className={inputCls}
            placeholder="you@example.com"
          />
        </Field>
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button type="button" onClick={onBack} className="rounded-xl border border-line px-5 py-3 text-mist hover:text-white">
          Back
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-aurora px-6 py-3 font-medium text-ink transition hover:shadow-[0_0_30px_rgb(124_255_103/0.5)] disabled:opacity-60"
        >
          {busy ? 'Holding your slot…' : 'Continue to payment'}
        </button>
      </div>
    </form>
  );
}

export const inputCls =
  'w-full rounded-xl border border-line bg-white/[0.04] px-4 py-3 text-base text-white placeholder:text-white/25 outline-none transition focus:border-aurora/60 focus:bg-white/[0.06]';

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-mist">{label}</span>
      {children}
      {error && <span className="mt-1.5 block text-xs text-rose-300">{error}</span>}
    </label>
  );
}

function Checkout({
  hold,
  onPaid,
  onCancel,
  onExpired,
}: {
  hold: Booking;
  onPaid: (b: Booking) => void;
  onCancel: () => void;
  onExpired: (msg: string) => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, (hold.holdExpiresAt ?? 0) - now);
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');

  useEffect(() => {
    if (left === 0) onExpired('Your hold expired before payment. The slot has been released, please pick again.');
  }, [left === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setBusy(true);
    try {
      // Simulates the redirect to a payment provider and back.
      await new Promise((r) => setTimeout(r, 1200));
      onPaid(await store.confirmPayment(hold.id));
    } catch (e) {
      onExpired((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <Panel>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold">Payment</h2>
          <span className={`rounded-full px-3 py-1 text-sm tabular-nums ${left < 120000 ? 'bg-rose-500/15 text-rose-200' : 'bg-aurora/10 text-aurora'}`}>
            Held for {mm}:{ss}
          </span>
        </div>

        <div className="mt-6 rounded-2xl border border-line p-4">
          <Summary date={hold.date} slots={hold.slots} total={hold.amount} />
        </div>

        <div className="mt-6 rounded-2xl border border-dashed border-amber-300/30 bg-amber-300/5 p-4 text-sm text-amber-100/80">
          <p className="font-medium text-amber-100">Demo checkout</p>
          <p className="mt-1">
            No payment provider is connected yet, so no money is charged. Once we choose one (for example
            PayMongo with GCash, Maya and cards), this button opens their secure checkout.
          </p>
        </div>

        <button
          type="button"
          onClick={pay}
          disabled={busy}
          className="mt-6 w-full rounded-xl bg-aurora py-4 font-medium text-ink transition hover:shadow-[0_0_30px_rgb(124_255_103/0.5)] disabled:opacity-60"
        >
          {busy ? 'Processing…' : `Pay ${formatMoney(hold.amount)} (demo)`}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="mt-3 w-full py-2 text-sm text-mist hover:text-white">
          Cancel and go back
        </button>
      </Panel>
    </div>
  );
}

function Confirmation({ booking, onAgain }: { booking: Booking; onAgain: () => void }) {
  return (
    <div className="mx-auto max-w-lg text-center">
      <Panel>
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-aurora text-ink shadow-[0_0_60px_rgb(124_255_103/0.5)]">
          <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <h2 className="mt-6 font-display text-3xl font-semibold">You're booked!</h2>
        <p className="mt-2 text-mist">
          See you on court, {booking.guest.name.split(' ')[0]}. A confirmation will be sent to {booking.guest.email}.
        </p>

        <div className="mt-6 rounded-2xl border border-aurora/30 bg-aurora/5 p-4">
          <p className="text-xs uppercase tracking-widest text-mist">Booking reference</p>
          <p className="mt-1 font-display text-3xl font-semibold tracking-wider text-aurora">{booking.reference}</p>
        </div>

        <div className="mt-6 text-left">
          <Summary date={booking.date} slots={booking.slots} total={booking.amount} />
        </div>

        <button type="button" onClick={onAgain} className="mt-8 w-full rounded-xl border border-line py-3 hover:border-white/25">
          Book another slot
        </button>
      </Panel>
    </div>
  );
}
