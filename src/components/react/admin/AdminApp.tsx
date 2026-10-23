import { useEffect, useMemo, useState } from 'react';
import { booking as cfg } from '../../../config/site';
import * as store from '../../../lib/booking/store';
import type { Block, Booking, BookingSource, DateKey, Guest, Slot } from '../../../lib/booking/types';
import {
  addDays,
  courtName,
  describeSlots,
  formatDate,
  formatHour,
  formatMoney,
  hours,
  isActive,
  slotKey,
  slotStates,
  todayKey,
} from '../../../lib/booking/utils';
import DayGrid, { Legend } from '../booking/DayGrid';
import { Field, inputCls } from '../booking/BookingApp';
import { useDay } from '../booking/hooks';

type Tab = 'schedule' | 'bookings' | 'closures';

export default function AdminApp() {
  const [date, setDate] = useState<DateKey>(todayKey);
  const [tab, setTab] = useState<Tab>('schedule');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);
  const [sheet, setSheet] = useState<'book' | 'block' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const { data } = useDay(date);

  const states = useMemo(() => slotStates(date, data?.bookings ?? [], data?.blocks ?? []), [date, data]);

  useEffect(() => setSelected(new Set()), [date]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const slots: Slot[] = [...selected].map((k) => {
    const [courtId, hour] = k.split('@');
    return { courtId: courtId as Slot['courtId'], hour: Number(hour) };
  });

  const onCell = (courtId: string, hour: number, st: ReturnType<typeof states.get>) => {
    if (!st) return;
    if (st.kind === 'booked' || st.kind === 'held') return setOpenBooking(st.booking);
    if (st.kind === 'blocked') {
      if (window.confirm(`Remove closure "${st.block.reason}"?`)) {
        store.removeBlock(st.block.id).then(() => setToast('Closure removed'));
      }
      return;
    }
    const k = slotKey(courtId, hour);
    setSelected((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-dashed border-amber-300/30 bg-amber-300/5 px-4 py-3 text-sm text-amber-100/80">
        <strong className="text-amber-100">Demo admin.</strong> There's no login yet and data is stored only in
        this browser. A real version needs a staff login and a shared database.
      </div>

      <Stats date={date} data={data} />

      <div className="my-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full border border-line bg-ink-2/70 p-1 text-sm">
          {(['schedule', 'bookings', 'closures'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-2 capitalize transition ${tab === t ? 'bg-aurora text-ink' : 'text-mist hover:text-white'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'schedule' && <DateNav date={date} onChange={setDate} />}
      </div>

      {tab === 'schedule' && (
        <section className="rounded-3xl border border-line bg-ink-2/80 p-4 backdrop-blur-xl sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-xl font-semibold">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
            <p className="text-xs text-mist">Tap open slots to select · tap a booking for details</p>
          </div>
          <DayGrid admin states={states} selected={selected} onCellClick={onCell} />
          <div className="mt-4">
            <Legend admin />
          </div>
        </section>
      )}

      {tab === 'bookings' && <BookingList onOpen={setOpenBooking} />}
      {tab === 'closures' && <Closures onToast={setToast} />}

      <div className="mt-10 flex justify-end">
        <button
          type="button"
          onClick={async () => {
            if (window.confirm('Reset all demo bookings and closures?')) {
              await store.resetDemoData();
              setToast('Demo data reset');
            }
          }}
          className="text-xs text-mist underline-offset-4 hover:text-white hover:underline"
        >
          Reset demo data
        </button>
      </div>

      {/* Selection action bar */}
      {tab === 'schedule' && selected.size > 0 && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-aurora/30 bg-ink-2/95 p-3 pl-5 backdrop-blur-xl">
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold">{selected.size} selected</span>{' '}
              <span className="text-mist">· {describeSlots(slots).join(', ')}</span>
            </p>
            <button type="button" onClick={() => setSelected(new Set())} className="text-sm text-mist hover:text-white">
              Clear
            </button>
            <button type="button" onClick={() => setSheet('block')} className="rounded-xl border border-line px-4 py-2.5 text-sm hover:border-amber-300/50">
              Close off
            </button>
            <button type="button" onClick={() => setSheet('book')} className="rounded-xl bg-aurora px-4 py-2.5 text-sm font-medium text-ink">
              Add booking
            </button>
          </div>
        </div>
      )}

      {sheet === 'book' && (
        <Sheet title="New booking" onClose={() => setSheet(null)}>
          <ManualBookingForm
            date={date}
            slots={slots}
            onDone={(msg) => {
              setSheet(null);
              setSelected(new Set());
              setToast(msg);
            }}
          />
        </Sheet>
      )}
      {sheet === 'block' && (
        <Sheet title="Close off time" onClose={() => setSheet(null)}>
          <QuickBlockForm
            date={date}
            slots={slots}
            onDone={(msg) => {
              setSheet(null);
              setSelected(new Set());
              setToast(msg);
            }}
          />
        </Sheet>
      )}
      {openBooking && (
        <Sheet title="Booking details" onClose={() => setOpenBooking(null)}>
          <BookingDetails
            booking={openBooking}
            onDone={(msg) => {
              setOpenBooking(null);
              setToast(msg);
            }}
          />
        </Sheet>
      )}

      {toast && (
        <div role="status" className="fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full border border-aurora/30 bg-ink-2/95 px-5 py-2.5 text-sm shadow-xl backdrop-blur">
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------- Stats ----------

function Stats({ date, data }: { date: DateKey; data: { bookings: Booking[]; blocks: Block[] } | null }) {
  const now = Date.now();
  const active = (data?.bookings ?? []).filter((b) => isActive(b, now));
  const confirmed = active.filter((b) => b.status === 'confirmed');
  const revenue = confirmed.filter((b) => b.paymentStatus === 'paid').reduce((s, b) => s + b.amount, 0);
  const unpaid = confirmed.filter((b) => b.paymentStatus === 'unpaid');
  const hoursBooked = confirmed.reduce((s, b) => s + b.slots.length, 0);
  const capacity = hours.length * cfg.courts.length;
  const held = active.filter((b) => b.status === 'held').length;

  const items = [
    { label: 'Bookings', value: String(confirmed.length) },
    { label: 'Paid revenue', value: formatMoney(revenue) },
    { label: 'Court usage', value: `${Math.round((hoursBooked / capacity) * 100)}%`, sub: `${hoursBooked}/${capacity} hrs` },
    {
      label: 'Unpaid',
      value: unpaid.length ? formatMoney(unpaid.reduce((s, b) => s + b.amount, 0)) : '—',
      sub: held ? `${held} on hold now` : undefined,
    },
  ];

  return (
    <div>
      <p className="mb-3 text-sm text-mist">{date === todayKey() ? 'Today' : formatDate(date)}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="rounded-2xl border border-line bg-ink-2/70 p-4 backdrop-blur">
            <p className="text-xs text-mist">{i.label}</p>
            <p className="mt-1 font-display text-2xl font-semibold">{i.value}</p>
            {i.sub && <p className="text-xs text-mist">{i.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DateNav({ date, onChange }: { date: DateKey; onChange: (d: DateKey) => void }) {
  const btn = 'grid size-9 place-items-center rounded-full border border-line text-mist hover:text-white hover:border-white/25';
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Previous day" className={btn} onClick={() => onChange(addDays(date, -1))}>‹</button>
      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="rounded-full border border-line bg-white/[0.04] px-3 py-1.5 text-sm text-white outline-none focus:border-aurora/60"
      />
      <button type="button" aria-label="Next day" className={btn} onClick={() => onChange(addDays(date, 1))}>›</button>
      <button type="button" className="rounded-full border border-line px-3 py-1.5 text-sm text-mist hover:text-white" onClick={() => onChange(todayKey())}>
        Today
      </button>
    </div>
  );
}

// ---------- Booking list ----------

const STATUS_STYLE: Record<Booking['status'], string> = {
  confirmed: 'bg-aurora/15 text-aurora',
  held: 'bg-sky-400/15 text-sky-200',
  cancelled: 'bg-white/10 text-mist',
  expired: 'bg-white/5 text-white/40',
};
const PAY_STYLE: Record<Booking['paymentStatus'], string> = {
  paid: 'text-aurora',
  pending: 'text-sky-200',
  unpaid: 'text-rose-300',
  refunded: 'text-mist',
};

function BookingList({ onOpen }: { onOpen: (b: Booking) => void }) {
  const [all, setAll] = useState<Booking[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'upcoming' | 'all' | Booking['status']>('upcoming');

  useEffect(() => {
    const load = () => store.getAll().then((d) => setAll(d.bookings));
    load();
    return store.subscribe(load);
  }, []);

  const today = todayKey();
  const now = Date.now();
  const list = all
    .filter((b) => {
      if (status === 'upcoming') return b.date >= today && isActive(b, now);
      if (status === 'all') return true;
      if (status === 'held') return b.status === 'held' && isActive(b, now);
      return b.status === status;
    })
    .filter((b) => {
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return [b.reference, b.guest.name, b.guest.phone, b.guest.email].some((v) => v.toLowerCase().includes(s));
    })
    .sort((a, b) => (status === 'upcoming' ? a.date.localeCompare(b.date) || a.slots[0].hour - b.slots[0].hour : b.createdAt - a.createdAt))
    .slice(0, 200);

  return (
    <section className="rounded-3xl border border-line bg-ink-2/80 p-4 backdrop-blur-xl sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email or reference" className={`${inputCls} flex-1`} />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={`${inputCls} sm:w-48`}>
          <option value="upcoming">Upcoming</option>
          <option value="all">All</option>
          <option value="confirmed">Confirmed</option>
          <option value="held">On hold</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {list.length === 0 ? (
        <p className="py-10 text-center text-mist">No bookings match.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onOpen(b)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-2 py-3 text-left transition hover:bg-white/[0.03]">
                <span className="w-28 font-mono text-xs text-mist">{b.reference}</span>
                <span className="min-w-[8rem] flex-1">
                  <span className="block font-medium">{b.guest.name}</span>
                  <span className="block text-xs text-mist">{b.guest.phone}</span>
                </span>
                <span className="min-w-[10rem] text-sm">
                  <span className="block">{formatDate(b.date)}</span>
                  <span className="block text-xs text-mist">{describeSlots(b.slots).join(', ')}</span>
                </span>
                <span className="w-20 text-sm">
                  <span className="block">{formatMoney(b.amount)}</span>
                  <span className={`block text-xs capitalize ${PAY_STYLE[b.paymentStatus]}`}>{b.paymentStatus}</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs capitalize ${STATUS_STYLE[b.status]}`}>{b.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Closures ----------

function Closures({ onToast }: { onToast: (m: string) => void }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [form, setForm] = useState({
    date: todayKey(),
    courtId: 'all' as Block['courtId'],
    startHour: cfg.openHour,
    endHour: cfg.openHour + 2,
    reason: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => store.getAll().then((d) => setBlocks(d.blocks));
    load();
    return store.subscribe(load);
  }, []);

  const upcoming = blocks.filter((b) => b.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date) || a.startHour - b.startHour);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-3xl border border-line bg-ink-2/80 p-4 backdrop-blur-xl sm:p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">Upcoming closures</h2>
        {upcoming.length === 0 ? (
          <p className="py-8 text-center text-mist">No closures scheduled.</p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center gap-4 py-3">
                <div className="flex-1">
                  <p className="font-medium">{b.reason}</p>
                  <p className="text-sm text-mist">
                    {formatDate(b.date)} · {b.courtId === 'all' ? 'All courts' : courtName(b.courtId)} · {formatHour(b.startHour)} – {formatHour(b.endHour)}
                  </p>
                </div>
                <button type="button" onClick={() => store.removeBlock(b.id).then(() => onToast('Closure removed'))} className="text-sm text-rose-300 hover:text-rose-200">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-line bg-ink-2/80 p-4 backdrop-blur-xl sm:p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">Add a closure</h2>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (!form.reason.trim()) return setError('Add a reason, e.g. "Maintenance".');
            try {
              await store.addBlock({ ...form, reason: form.reason.trim() });
              setForm({ ...form, reason: '' });
              onToast('Closure added');
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <Field label="Date">
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Court">
            <select value={form.courtId} onChange={(e) => setForm({ ...form, courtId: e.target.value as Block['courtId'] })} className={inputCls}>
              <option value="all">All courts</option>
              {cfg.courts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <HourSelect value={form.startHour} onChange={(v) => setForm({ ...form, startHour: v })} from={cfg.openHour} to={cfg.closeHour - 1} />
            </Field>
            <Field label="Until">
              <HourSelect value={form.endHour} onChange={(v) => setForm({ ...form, endHour: v })} from={cfg.openHour + 1} to={cfg.closeHour} />
            </Field>
          </div>
          <Field label="Reason" error={error}>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Maintenance, tournament…" className={inputCls} />
          </Field>
          <p className="text-xs text-mist">Existing bookings in this time are not cancelled automatically.</p>
          <button className="w-full rounded-xl bg-aurora py-3 font-medium text-ink">Add closure</button>
        </form>
      </section>
    </div>
  );
}

function HourSelect({ value, onChange, from, to }: { value: number; onChange: (v: number) => void; from: number; to: number }) {
  const opts = [];
  for (let h = from; h <= to; h++) opts.push(h);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
      {opts.map((h) => (
        <option key={h} value={h}>{formatHour(h)}</option>
      ))}
    </select>
  );
}

// ---------- Sheets ----------

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-ink-2 p-6 sm:rounded-3xl"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full border border-line text-mist hover:text-white">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ManualBookingForm({ date, slots, onDone }: { date: DateKey; slots: Slot[]; onDone: (msg: string) => void }) {
  const [guest, setGuest] = useState<Guest>({ name: '', phone: '', email: '' });
  const [source, setSource] = useState<Exclude<BookingSource, 'online'>>('walk-in');
  const [paid, setPaid] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        if (guest.name.trim().length < 2) return setError('Enter the guest name.');
        if (!guest.phone.trim() && !guest.email.trim()) return setError('Add a phone number or email.');
        try {
          const b = await store.createManualBooking(date, slots, { name: guest.name.trim(), phone: guest.phone.trim(), email: guest.email.trim() }, source, paid, notes.trim() || undefined);
          onDone(`Booked · ${b.reference}`);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div className="rounded-2xl border border-line p-3 text-sm">
        <p className="text-mist">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
        {describeSlots(slots).map((l) => (
          <p key={l}>{l}</p>
        ))}
        <p className="mt-1 font-semibold">{formatMoney(slots.length * cfg.pricePerHour)}</p>
      </div>
      <Field label="Guest name">
        <input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <input type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Email">
          <input type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Source">
          <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={inputCls}>
            <option value="walk-in">Walk-in</option>
            <option value="phone">Phone</option>
          </select>
        </Field>
        <Field label="Payment">
          <select value={paid ? 'paid' : 'unpaid'} onChange={(e) => setPaid(e.target.value === 'paid')} className={inputCls}>
            <option value="paid">Paid (cash)</option>
            <option value="unpaid">Not yet paid</option>
          </select>
        </Field>
      </div>
      <Field label="Notes (optional)" error={error}>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
      </Field>
      <button className="w-full rounded-xl bg-aurora py-3 font-medium text-ink">Save booking</button>
    </form>
  );
}

function QuickBlockForm({ date, slots, onDone }: { date: DateKey; slots: Slot[]; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!reason.trim()) return setError('Add a reason.');
        // One closure per court per run of consecutive hours.
        for (const court of cfg.courts) {
          const hs = slots.filter((s) => s.courtId === court.id).map((s) => s.hour).sort((a, b) => a - b);
          let i = 0;
          while (i < hs.length) {
            let j = i;
            while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
            await store.addBlock({ date, courtId: court.id, startHour: hs[i], endHour: hs[j] + 1, reason: reason.trim() });
            i = j + 1;
          }
        }
        onDone('Time closed off');
      }}
    >
      <div className="rounded-2xl border border-line p-3 text-sm">
        <p className="text-mist">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
        {describeSlots(slots).map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
      <Field label="Reason" error={error}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Maintenance, private event…" className={inputCls} autoFocus />
      </Field>
      <button className="w-full rounded-xl bg-amber-300 py-3 font-medium text-ink">Close off</button>
    </form>
  );
}

function BookingDetails({ booking: b, onDone }: { booking: Booking; onDone: (msg: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [refund, setRefund] = useState(true);
  const canCancel = b.status === 'confirmed' || b.status === 'held';

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-mist">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );

  return (
    <div>
      <p className="font-display text-2xl font-semibold tracking-wider text-aurora">{b.reference}</p>
      <div className="mt-4 divide-y divide-line">
        {row('Guest', b.guest.name)}
        {row('Phone', b.guest.phone ? <a href={`tel:${b.guest.phone}`} className="hover:text-aurora">{b.guest.phone}</a> : '—')}
        {row('Email', b.guest.email || '—')}
        {row('Date', formatDate(b.date, { weekday: 'long', month: 'long' }))}
        {row('Time', describeSlots(b.slots).map((l) => <span key={l} className="block">{l}</span>))}
        {row('Amount', formatMoney(b.amount))}
        {row('Payment', <span className={`capitalize ${PAY_STYLE[b.paymentStatus]}`}>{b.paymentStatus}</span>)}
        {row('Status', <span className="capitalize">{b.status}</span>)}
        {row('Source', <span className="capitalize">{b.source}</span>)}
        {b.notes && row('Notes', b.notes)}
      </div>

      {canCancel && (
        <div className="mt-6 space-y-3">
          {b.paymentStatus === 'unpaid' && b.status === 'confirmed' && (
            <button type="button" onClick={() => store.markPaid(b.id).then(() => onDone('Marked as paid'))} className="w-full rounded-xl bg-aurora py-3 font-medium text-ink">
              Mark as paid
            </button>
          )}
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className="w-full rounded-xl border border-rose-400/40 py-3 text-rose-200 hover:bg-rose-500/10">
              Cancel booking
            </button>
          ) : (
            <div className="rounded-2xl border border-rose-400/40 p-4">
              <p className="text-sm">Cancel this booking and free up the slot?</p>
              {b.paymentStatus === 'paid' && (
                <label className="mt-3 flex items-center gap-2 text-sm text-mist">
                  <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} className="accent-[#7cff67]" />
                  Mark as refunded
                </label>
              )}
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-xl border border-line py-2.5 text-sm">
                  Keep
                </button>
                <button type="button" onClick={() => store.cancelBooking(b.id, refund).then(() => onDone('Booking cancelled'))} className="flex-1 rounded-xl bg-rose-500 py-2.5 text-sm font-medium text-white">
                  Yes, cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
