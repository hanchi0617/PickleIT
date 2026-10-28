import { useEffect, useMemo, useRef, useState } from 'react';
import type { Backend } from '../../../lib/booking/api';
import { getMyBookings, saveMyBooking, updateMyBooking } from '../../../lib/booking/myBookings';
import { SlotTakenError, type Booking, type DateKey, type DiscountCode, type Guest, type Settings, type Slot, type SlotState } from '../../../lib/booking/types';
import {
  buildSlotStates,
  dayHours,
  describeSlots,
  formatDate,
  formatHour,
  formatMoney,
  hoursList,
  isPeak,
  parseSlotKey,
  quote,
  slotKey,
  slotPrice,
  venueToday,
} from '../../../lib/booking/utils';
import { Alert, Field, Icon, Panel, Sheet, Spinner, icons } from '../ui';
import CourtMarker from './CourtMarker';
import DayGrid, { Legend } from './DayGrid';
import { useAvailability, useBackend, useNow, useSettings } from './hooks';
import MonthCalendar from './MonthCalendar';
import MyBookings, { useMyBookings } from './MyBookings';
import ReminderActions from './ReminderActions';

type Step = 'pick' | 'details' | 'checkout' | 'done';

export default function BookingApp() {
  const backend = useBackend();
  const settings = useSettings();
  if (!backend || !settings) return <Spinner />;
  return <Booker backend={backend} settings={settings} />;
}

function Booker({ backend, settings: s }: { backend: Backend; settings: Settings }) {
  const [date, setDate] = useState<DateKey>(() => venueToday(s));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('pick');
  const [guest, setGuest] = useState<Guest>({ name: '', phone: '', email: '' });
  const [discount, setDiscount] = useState<Pick<DiscountCode, 'code' | 'kind' | 'value'> | null>(null);
  const [hold, setHold] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightCourt, setHighlightCourt] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ kind: 'mine'; bookingId: string } | { kind: 'waitlist'; courtId: string; hour: number } | null>(null);
  const availability = useAvailability(date, date);
  const mine = useMyBookings();
  const topRef = useRef<HTMLDivElement>(null);
  // True while this renter is placing their own hold, so their slots turning
  // "held" isn't mistaken for someone else taking them.
  const submitting = useRef(false);

  const mineIds = useMemo(() => new Set(mine.filter((b) => b.status === 'confirmed').map((b) => b.id)), [mine]);
  const mineDates = useMemo(() => new Set(mine.filter((b) => b.status === 'confirmed').map((b) => b.date)), [mine]);
  const hours = hoursList(s, date);
  const courts = s.courts.filter((c) => c.active);

  // ?court=c2 highlights a court; ?paid=REF is the return from the payment page.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const court = q.get('court');
    if (court && s.courts.some((c) => c.id === court)) setHighlightCourt(court);
    const paid = q.get('paid');
    if (paid) waitForPayment(paid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const states = useMemo(
    () => buildSlotStates({ settings: s, date, occupancy: availability?.occupancy ?? [], blocks: availability?.blocks ?? [], mine: mineIds }),
    [s, date, availability, mineIds],
  );

  // If someone else takes a slot we had selected, drop it and say so.
  useEffect(() => {
    if ((step !== 'pick' && step !== 'details') || submitting.current) return;
    const lost = [...selected].filter((k) => states.get(k)?.kind !== 'open');
    if (lost.length) {
      setSelected((cur) => new Set([...cur].filter((k) => !lost.includes(k))));
      setError('An hour you picked was just taken by someone else, so we removed it.');
      if (step === 'details' && lost.length === selected.size) setStep('pick');
    }
  }, [states]); // eslint-disable-line react-hooks/exhaustive-deps

  const slots: Slot[] = useMemo(() => [...selected].map(parseSlotKey), [selected]);
  const price = quote(s, date, slots, discount);

  const goTo = (next: Step) => {
    setStep(next);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const onCell = (courtId: string, hour: number, st: SlotState) => {
    setError(null);
    const k = slotKey(courtId, hour);
    if (st.kind === 'mine') return setViewing({ kind: 'mine', bookingId: st.bookingId });
    if (st.kind === 'booked' || st.kind === 'held') return setViewing({ kind: 'waitlist', courtId, hour });
    if (st.kind !== 'open' && !selected.has(k)) return;
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const changeDate = (d: DateKey) => {
    setDate(d);
    setSelected(new Set());
    setError(null);
  };

  const showOnCalendar = (d: DateKey) => {
    changeDate(d);
    goTo('pick');
  };

  const startCheckout = async () => {
    setError(null);
    submitting.current = true;
    try {
      const h = await backend.createHold({
        date,
        slots,
        guest: { name: guest.name.trim(), phone: guest.phone.trim(), email: guest.email.trim() },
        discountCode: discount?.code,
      });
      setHold(h);
      saveMyBooking({ id: h.id, reference: h.reference, contact: h.guest.email, date: h.date, slots: h.slots, amount: h.amount, status: 'held', savedAt: Date.now() });
      const pay = await backend.startPayment(h.id, h.reference);
      if (pay.url) {
        window.location.href = pay.url; // off to the payment provider
        return;
      }
      goTo('checkout');
    } catch (e) {
      if (e instanceof SlotTakenError) goTo('pick');
      setError((e as Error).message);
    } finally {
      submitting.current = false;
    }
  };

  const finish = (b: Booking) => {
    saveMyBooking({ id: b.id, reference: b.reference, contact: b.guest.email, date: b.date, slots: b.slots, amount: b.amount, status: 'confirmed', savedAt: Date.now() });
    setHold(b);
    setSelected(new Set());
    setDiscount(null);
    goTo('done');
  };

  // Back from the payment page: wait for the webhook to confirm the booking.
  async function waitForPayment(reference: string) {
    const saved = getMyBookings().find((b) => b.reference === reference);
    if (!saved) return;
    goTo('checkout');
    setHold({ ...saved, guest: { name: '', phone: '', email: saved.contact }, paymentStatus: 'pending', source: 'online', createdAt: saved.savedAt, attendance: 'pending' } as Booking);
    for (let i = 0; i < 15; i++) {
      const v = await backend.findBooking(reference, saved.contact).catch(() => null);
      if (v?.status === 'confirmed') {
        updateMyBooking(v);
        setHold({ ...v, guest: { name: v.guestName, phone: '', email: saved.contact }, source: 'online', createdAt: saved.savedAt } as Booking);
        setDate(v.date);
        goTo('done');
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setError('We have not received your payment confirmation yet. If you paid, it will appear under My bookings shortly.');
    goTo('pick');
  }

  return (
    <div ref={topRef} className="scroll-mt-24">
      <Stepper step={step} />

      {error && (
        <div className="mb-6">
          <Alert>{error}</Alert>
        </div>
      )}

      {step === 'pick' && (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <Panel>
            <MonthCalendar settings={s} value={date} onChange={changeDate} markers={mineDates} />
          </Panel>

          <Panel>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-mist">Availability for</p>
                <p className="font-display text-2xl font-semibold">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
              </div>
              <span className="inline-flex items-center gap-2 text-xs text-mist">
                <span className="size-1.5 animate-pulse rounded-full bg-aurora" /> Live
              </span>
            </div>

            {mineDates.has(date) && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-aurora/40 bg-aurora/10 px-3 py-2 text-sm">
                <Icon d={icons.pin} className="size-4 text-aurora" />
                You have a booking today. It's marked <span className="font-semibold text-aurora">Yours</span> below.
              </div>
            )}

            {!dayHours(s, date) ? (
              <p className="py-16 text-center text-mist">
                {s.holidays.find((h) => h.date === date)?.reason ?? 'The venue is closed on this day.'}
              </p>
            ) : (
              <>
                <DayGrid courts={courts} hours={hours} states={states} selected={selected} highlightCourt={highlightCourt} onCellClick={onCell} />
                <div className="mt-5">
                  <Legend />
                </div>
                {s.peak.enabled && (
                  <p className="mt-3 text-xs text-mist">
                    Peak hours ({formatHour(s.peak.startHour)} – {formatHour(s.peak.endHour)}) are {formatMoney(s.peak.pricePerHour, s.currencySymbol)}/hr.
                  </p>
                )}
              </>
            )}
          </Panel>
        </div>
      )}

      {step === 'details' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Panel>
            <GuestForm guest={guest} onChange={setGuest} onBack={() => goTo('pick')} onSubmit={startCheckout} />
          </Panel>
          <div className="space-y-6">
            <Panel>
              <Summary settings={s} date={date} slots={slots} discount={discount} />
            </Panel>
            <Panel>
              <DiscountInput backend={backend} applied={discount} onApply={setDiscount} />
            </Panel>
          </div>
        </div>
      )}

      {step === 'checkout' && hold && (
        <Checkout
          backend={backend}
          settings={s}
          hold={hold}
          onPaid={finish}
          onCancel={async () => {
            await backend.releaseHold(hold.id, hold.reference).catch(() => {});
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

      {step === 'done' && hold && (
        <Confirmation
          settings={s}
          booking={hold}
          onShow={() => showOnCalendar(hold.date)}
          onAgain={() => {
            setHold(null);
            goTo('pick');
          }}
        />
      )}

      {step === 'pick' && (
        <SelectionBar settings={s} count={slots.length} total={price.total} lines={describeSlots(s, slots)} onClear={() => setSelected(new Set())} onNext={() => goTo('details')} />
      )}

      {step === 'pick' && (
        <div className="mt-16">
          <MyBookings backend={backend} settings={s} onShow={showOnCalendar} />
        </div>
      )}

      {viewing?.kind === 'mine' && (
        <MineSheet settings={s} bookingId={viewing.bookingId} onClose={() => setViewing(null)} />
      )}
      {viewing?.kind === 'waitlist' && (
        <WaitlistSheet backend={backend} settings={s} date={date} courtId={viewing.courtId} hour={viewing.hour} guest={guest} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: [Step, string][] = [
    ['pick', 'Pick a slot'],
    ['details', 'Your details'],
    ['checkout', 'Payment'],
    ['done', 'Confirmed'],
  ];
  const idx = steps.findIndex(([x]) => x === step);
  return (
    <ol className="mb-8 flex items-center gap-2 text-xs sm:text-sm">
      {steps.map(([x, label], i) => (
        <li key={x} className="flex flex-1 items-center gap-2">
          <span
            className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
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

function SelectionBar({ settings, count, total, lines, onClear, onNext }: { settings: Settings; count: number; total: number; lines: string[]; onClear: () => void; onNext: () => void }) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-30 px-4 transition-transform duration-300 ${count ? 'translate-y-0' : 'translate-y-[130%]'}`}
      style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      aria-hidden={!count}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-line bg-ink-2/95 p-3 pl-5 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">
            {formatMoney(total, settings.currencySymbol)}{' '}
            <span className="text-sm font-normal text-mist">
              · {count} hour{count === 1 ? '' : 's'}
            </span>
          </p>
          <p className="truncate text-xs text-mist">{lines.join(', ')}</p>
        </div>
        <button type="button" onClick={onClear} className="btn btn-ghost hidden sm:inline-flex" tabIndex={count ? 0 : -1}>
          Clear
        </button>
        <button type="button" onClick={onNext} tabIndex={count ? 0 : -1} className="btn btn-primary">
          Continue <Icon d={icons.arrow} className="arrow size-4" />
        </button>
      </div>
    </div>
  );
}

function Summary({ settings: s, date, slots, discount, amount }: { settings: Settings; date: DateKey; slots: Slot[]; discount?: Pick<DiscountCode, 'kind' | 'value' | 'code'> | null; amount?: number }) {
  const q = quote(s, date, slots, discount);
  const peakHours = slots.filter((x) => isPeak(s, date, x.hour)).length;
  return (
    <div>
      <p className="text-sm text-mist">Your booking</p>
      <p className="mt-1 font-display text-xl font-semibold">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
      <div className="mt-4">
        <CourtMarker settings={s} slots={slots} />
      </div>
      <dl className="mt-5 space-y-1.5 border-t border-line pt-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-mist">
            {slots.length} hour{slots.length === 1 ? '' : 's'}
            {peakHours ? ` (${peakHours} peak)` : ` × ${formatMoney(slotPrice(s, slots[0]?.courtId ?? '', date, slots[0]?.hour ?? 0), s.currencySymbol)}`}
          </dt>
          <dd>{formatMoney(q.subtotal, s.currencySymbol)}</dd>
        </div>
        {q.discountAmount > 0 && (
          <div className="flex justify-between text-aurora">
            <dt>Discount {discount?.code}</dt>
            <dd>−{formatMoney(q.discountAmount, s.currencySymbol)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between pt-2">
          <dt className="text-mist">Total</dt>
          <dd className="font-display text-2xl font-semibold">{formatMoney(amount ?? q.total, s.currencySymbol)}</dd>
        </div>
      </dl>
    </div>
  );
}

function DiscountInput({ backend, applied, onApply }: { backend: Backend; applied: Pick<DiscountCode, 'code' | 'kind' | 'value'> | null; onApply: (d: Pick<DiscountCode, 'code' | 'kind' | 'value'> | null) => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>
          Code <span className="font-semibold text-aurora">{applied.code}</span> applied
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onApply(null)}>
          Remove
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim()) return;
        const d = await backend.checkDiscount(code).catch(() => null);
        setMsg(d ? '' : 'That code is not valid.');
        if (d) onApply(d);
      }}
    >
      <Field label="Discount code" error={msg}>
        <div className="flex gap-2">
          <input className="input uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional" />
          <button className="btn btn-secondary">Apply</button>
        </div>
      </Field>
    </form>
  );
}

const PHONE_RE = /^[+\d][\d\s()-]{6,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function GuestForm({ guest, onChange, onBack, onSubmit }: { guest: Guest; onChange: (g: Guest) => void; onBack: () => void; onSubmit: () => Promise<void> }) {
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
      <p className="mt-1 text-sm text-mist">No account needed. We'll send your confirmation and reminder here.</p>

      <div className="mt-6 space-y-4">
        <Field label="Full name" error={touched ? errors.name : ''}>
          <input autoComplete="name" value={guest.name} onChange={(e) => onChange({ ...guest, name: e.target.value })} className="input" placeholder="Juan Dela Cruz" />
        </Field>
        <Field label="Mobile number" error={touched ? errors.phone : ''}>
          <input type="tel" inputMode="tel" autoComplete="tel" value={guest.phone} onChange={(e) => onChange({ ...guest, phone: e.target.value })} className="input" placeholder="0917 123 4567" />
        </Field>
        <Field label="Email" error={touched ? errors.email : ''}>
          <input type="email" inputMode="email" autoComplete="email" value={guest.email} onChange={(e) => onChange({ ...guest, email: e.target.value })} className="input" placeholder="you@example.com" />
        </Field>
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button type="button" onClick={onBack} className="btn btn-secondary">
          Back
        </button>
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? 'Holding your slot…' : 'Continue to payment'}
        </button>
      </div>
    </form>
  );
}

function Checkout({
  backend,
  settings: s,
  hold,
  onPaid,
  onCancel,
  onExpired,
}: {
  backend: Backend;
  settings: Settings;
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
  const waiting = !hold.holdExpiresAt; // returning from the payment provider

  useEffect(() => {
    if (!waiting && left === 0) onExpired('Your hold expired before payment. The slot has been released, please pick again.');
  }, [left === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (waiting) {
    return (
      <div className="mx-auto max-w-lg">
        <Panel>
          <Spinner label="Confirming your payment…" />
        </Panel>
      </div>
    );
  }

  const pay = async () => {
    setBusy(true);
    try {
      onPaid(await backend.demoPay(hold.id, hold.reference));
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
          <Summary settings={s} date={hold.date} slots={hold.slots} amount={hold.amount} discount={hold.discountCode ? { code: hold.discountCode, kind: 'fixed', value: hold.discountAmount ?? 0 } : null} />
        </div>

        <div className="mt-6">
          <Alert tone="warn">
            <strong className="text-amber-100">Demo checkout.</strong> No payment provider is connected yet, so no money is charged. Once one is
            set up (for example PayMongo with GCash, Maya and cards), this step opens their secure checkout instead.
          </Alert>
        </div>

        <button type="button" onClick={pay} disabled={busy} className="btn btn-primary btn-lg btn-block mt-6">
          {busy ? 'Processing…' : `Pay ${formatMoney(hold.amount, s.currencySymbol)} (demo)`}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost btn-block mt-2">
          Cancel and go back
        </button>
      </Panel>
    </div>
  );
}

function Confirmation({ settings: s, booking, onShow, onAgain }: { settings: Settings; booking: Booking; onShow: () => void; onAgain: () => void }) {
  return (
    <div className="mx-auto max-w-xl">
      <Panel className="text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-aurora text-ink">
          <Icon d={icons.check} className="size-7" />
        </div>
        <h2 className="mt-5 font-display text-3xl font-semibold">You're booked!</h2>
        <p className="mt-2 text-mist">
          See you on court{booking.guest.name ? `, ${booking.guest.name.split(' ')[0]}` : ''}.
          {booking.guest.email && ` A confirmation is on its way to ${booking.guest.email}.`}
        </p>

        <div className="mt-6 rounded-2xl border border-aurora/30 bg-aurora/5 p-4">
          <p className="text-xs uppercase tracking-widest text-mist">Booking reference</p>
          <p className="mt-1 font-display text-3xl font-semibold tracking-wider text-aurora">{booking.reference}</p>
        </div>

        <div className="mt-6 text-left">
          <p className="mb-1 font-display text-lg font-semibold">{formatDate(booking.date, { weekday: 'long', month: 'long' })}</p>
          <p className="mb-3 text-sm text-mist">Here's where and when you're playing:</p>
          <CourtMarker settings={s} slots={booking.slots} />
        </div>

        <div className="mt-6 rounded-2xl border border-line p-4 text-left">
          <p className="flex items-center gap-2 font-medium">
            <Icon d={icons.bell} className="size-4 text-aurora" /> Set a reminder
          </p>
          <p className="mb-3 mt-1 text-sm text-mist">Your phone will remind you the day before and an hour before.</p>
          <ReminderActions settings={s} booking={booking} />
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={onShow} className="btn btn-secondary flex-1">
            <Icon d={icons.pin} /> See it on the calendar
          </button>
          <button type="button" onClick={onAgain} className="btn btn-ghost flex-1">
            Book another slot
          </button>
        </div>
      </Panel>
    </div>
  );
}

function MineSheet({ settings: s, bookingId, onClose }: { settings: Settings; bookingId: string; onClose: () => void }) {
  const b = getMyBookings().find((x) => x.id === bookingId);
  if (!b) return null;
  return (
    <Sheet title="Your booking" onClose={onClose}>
      <p className="font-display text-lg font-semibold">{formatDate(b.date, { weekday: 'long', month: 'long' })}</p>
      <p className="mb-4 text-sm text-mist">Reference {b.reference}</p>
      <CourtMarker settings={s} slots={b.slots} />
      <div className="mt-5">
        <ReminderActions settings={s} booking={b} size="sm" />
      </div>
      <a href="#my-bookings" onClick={onClose} className="btn btn-ghost btn-sm mt-4">
        Manage in My bookings
      </a>
    </Sheet>
  );
}

function WaitlistSheet({ backend, settings: s, date, courtId, hour, guest, onClose }: { backend: Backend; settings: Settings; date: DateKey; courtId: string; hour: number; guest: Guest; onClose: () => void }) {
  const [g, setG] = useState(guest);
  const [anyCourt, setAnyCourt] = useState(true);
  const [state, setState] = useState<'form' | 'busy' | 'done'>('form');
  const [error, setError] = useState('');

  return (
    <Sheet title="This hour is taken" onClose={onClose}>
      {state === 'done' ? (
        <div className="space-y-4">
          <Alert tone="success">You're on the waitlist. The venue will contact you if it frees up.</Alert>
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (g.name.trim().length < 2 || (!g.phone.trim() && !g.email.trim())) return setError('Add your name and a phone number or email.');
            setState('busy');
            try {
              await backend.joinWaitlist({ date, courtId: anyCourt ? null : courtId, hour, guest: g });
              setState('done');
            } catch (err) {
              setError((err as Error).message);
              setState('form');
            }
          }}
        >
          <p className="text-sm text-mist">
            {s.courts.find((c) => c.id === courtId)?.name} at {formatHour(hour)} on {formatDate(date)} is booked. Join the waitlist and we'll let
            you know if it opens up.
          </p>
          <Field label="Name">
            <input className="input" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile">
              <input className="input" type="tel" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-[#7cff67]" checked={anyCourt} onChange={(e) => setAnyCourt(e.target.checked)} />
            Any court is fine
          </label>
          {error && <Alert>{error}</Alert>}
          <button className="btn btn-primary btn-block" disabled={state === 'busy'}>
            {state === 'busy' ? 'Joining…' : 'Join waitlist'}
          </button>
        </form>
      )}
    </Sheet>
  );
}
