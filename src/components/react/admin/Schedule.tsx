import { useMemo, useState } from 'react';
import type { Block, Booking, BookingSource, DateKey, Guest, Slot, SlotState } from '../../../lib/booking/types';
import {
  addDays,
  buildSlotStates,
  describeSlots,
  formatDate,
  formatMoney,
  formatRange,
  hoursList,
  isActiveBooking,
  parseSlotKey,
  quote,
  slotKey,
  slotRuns,
  startHour,
  endHour,
  uid,
  venueNow,
  venueToday,
} from '../../../lib/booking/utils';
import DayGrid, { Legend } from '../booking/DayGrid';
import { useLive } from '../booking/hooks';
import { Alert, Field, Icon, Sheet, Spinner, icons } from '../ui';
import { act, PaymentBadge, StatusBadge, type AdminCtx } from './shared';

export default function Schedule({ ctx }: { ctx: AdminCtx }) {
  const s = ctx.settings;
  const [date, setDate] = useState<DateKey>(() => venueToday(s));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<'book' | 'block' | null>(null);
  const [data] = useLive((b) => Promise.all([b.listBookings(date, date), b.listBlocks(date, date)]), [date]);
  const [bookings, blocks] = data ?? [[], []];

  // Show opening hours plus any hour that has a booking (e.g. if hours changed later).
  const hours = useMemo(() => {
    const set = new Set(hoursList(s, date));
    for (const b of bookings) if (isActiveBooking(b)) b.slots.forEach((x) => set.add(x.hour));
    return [...set].sort((a, z) => a - z);
  }, [s, date, bookings]);

  const states = useMemo(() => buildSlotStates({ settings: s, date, bookings, blocks, hours }), [s, date, bookings, blocks, hours]);
  const slots: Slot[] = [...selected].map(parseSlotKey);

  const changeDate = (d: DateKey) => {
    setDate(d);
    setSelected(new Set());
  };

  const onCell = (courtId: string, hour: number, st: SlotState) => {
    if (st.kind === 'booked' || st.kind === 'held' || st.kind === 'mine') return st.booking && ctx.openBooking(st.booking);
    if (st.kind === 'blocked') {
      if (window.confirm(`Remove closure "${st.block.reason}"?`)) act(ctx, () => ctx.backend.removeBlock(st.block.id), 'Closure removed');
      return;
    }
    if (st.kind !== 'open' && st.kind !== 'past') return;
    const k = slotKey(courtId, hour);
    setSelected((cur) => {
      const n = new Set(cur);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-2xl font-semibold">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
        <DateNav date={date} today={venueToday(s)} onChange={changeDate} />
      </div>

      <DayStats ctx={ctx} bookings={bookings} hoursCount={hoursList(s, date).length} />

      {!data ? (
        <Spinner />
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          <section className="card min-w-0 p-4 sm:p-6">
            <p className="mb-4 text-xs text-mist">Tap open slots to select them · tap a booking for details</p>
            {hours.length ? (
              <DayGrid admin courts={s.courts} hours={hours} states={states} selected={selected} onCellClick={onCell} />
            ) : (
              <p className="py-10 text-center text-mist">Closed on this day.</p>
            )}
            <div className="mt-4">
              <Legend admin />
            </div>
          </section>

          <Arrivals ctx={ctx} date={date} bookings={bookings} />
        </div>
      )}

      {selected.size > 0 && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-ink-2/95 p-3 pl-5 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold">{selected.size} selected</span> <span className="text-mist">· {describeSlots(s, slots).join(', ')}</span>
            </p>
            <button type="button" onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm">
              Clear
            </button>
            <button type="button" onClick={() => setSheet('block')} className="btn btn-secondary btn-sm">
              Close off
            </button>
            <button type="button" onClick={() => setSheet('book')} className="btn btn-primary btn-sm">
              Add booking
            </button>
          </div>
        </div>
      )}

      {sheet === 'book' && (
        <NewBookingSheet
          ctx={ctx}
          date={date}
          slots={slots}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            setSelected(new Set());
          }}
        />
      )}
      {sheet === 'block' && (
        <BlockSheet
          ctx={ctx}
          date={date}
          slots={slots}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}

function DateNav({ date, today, onChange }: { date: DateKey; today: DateKey; onChange: (d: DateKey) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Previous day" className="btn btn-secondary btn-sm size-9 !p-0" onClick={() => onChange(addDays(date, -1))}>
        ‹
      </button>
      <input type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} className="input !w-auto !py-1.5 text-sm" aria-label="Date" />
      <button type="button" aria-label="Next day" className="btn btn-secondary btn-sm size-9 !p-0" onClick={() => onChange(addDays(date, 1))}>
        ›
      </button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={date === today} onClick={() => onChange(today)}>
        Today
      </button>
    </div>
  );
}

function DayStats({ ctx, bookings, hoursCount }: { ctx: AdminCtx; bookings: Booking[]; hoursCount: number }) {
  const s = ctx.settings;
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const revenue = confirmed.filter((b) => b.paymentStatus === 'paid').reduce((x, b) => x + b.amount, 0);
  const booked = confirmed.reduce((x, b) => x + b.slots.length, 0);
  const capacity = hoursCount * s.courts.filter((c) => c.active).length;
  const checkedIn = confirmed.filter((b) => b.attendance === 'checked-in').length;
  const noShow = confirmed.filter((b) => b.attendance === 'no-show').length;
  const unpaid = confirmed.filter((b) => b.paymentStatus === 'unpaid');

  const items = [
    { label: 'Bookings', value: String(confirmed.length), sub: `${checkedIn} checked in · ${noShow} no-show` },
    { label: 'Paid revenue', value: formatMoney(revenue, s.currencySymbol) },
    { label: 'Court usage', value: capacity ? `${Math.round((booked / capacity) * 100)}%` : '—', sub: `${booked}/${capacity} hours` },
    { label: 'Unpaid', value: unpaid.length ? formatMoney(unpaid.reduce((x, b) => x + b.amount, 0), s.currencySymbol) : '—', sub: unpaid.length ? `${unpaid.length} booking${unpaid.length === 1 ? '' : 's'}` : undefined },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="card !rounded-2xl p-4">
          <p className="text-xs text-mist">{i.label}</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{i.value}</p>
          {i.sub && <p className="text-xs text-mist">{i.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** Today's renters in time order, with one-tap check-in and no-show. */
function Arrivals({ ctx, date, bookings }: { ctx: AdminCtx; date: DateKey; bookings: Booking[] }) {
  const s = ctx.settings;
  const today = venueToday(s);
  const now = venueNow(s.timezone);
  const canMark = date <= today;
  const list = bookings.filter((b) => b.status === 'confirmed').sort((a, z) => startHour(a.slots) - startHour(z.slots));
  const waiting = list.filter((b) => b.attendance === 'pending').length;

  return (
    <section className="card min-w-0 p-4 sm:p-6" aria-label="Check-in">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Check-in</h2>
        {list.length > 0 && <span className="text-xs text-mist">{waiting} waiting</span>}
      </div>
      {!canMark && <p className="mb-3 text-xs text-mist">Check-in opens on the day of the booking.</p>}
      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-mist">No bookings.</p>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => {
            const live = date === today && now.hour >= startHour(b.slots) && now.hour < endHour(b.slots);
            return (
              <li key={b.id} className={`rounded-2xl border p-3 ${live ? 'border-aurora/40 bg-aurora/[0.06]' : 'border-line'}`}>
                <button type="button" onClick={() => ctx.openBooking(b)} className="block w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{b.guest.name}</span>
                    {live && <span className="text-[11px] font-semibold uppercase tracking-wider text-aurora">On court now</span>}
                  </div>
                  <p className="text-xs text-mist">
                    {slotRuns(b.slots).map((r) => `${s.courts.find((c) => c.id === r.courtId)?.name} ${formatRange(r.start, r.end)}`).join(', ')}
                  </p>
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PaymentBadge b={b} />
                  {b.attendance === 'pending' ? (
                    <>
                      <span className="flex-1" />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!canMark}
                        onClick={() => act(ctx, () => ctx.backend.setAttendance(b.id, 'checked-in'), `${b.guest.name} checked in`)}
                      >
                        <Icon d={icons.check} /> Check in
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger-outline btn-sm"
                        disabled={!canMark}
                        onClick={() => act(ctx, () => ctx.backend.setAttendance(b.id, 'no-show'), `${b.guest.name} marked as no-show`)}
                      >
                        No-show
                      </button>
                    </>
                  ) : (
                    <>
                      <StatusBadge b={b} />
                      <span className="flex-1" />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(ctx, () => ctx.backend.setAttendance(b.id, 'pending'), 'Attendance reset')}>
                        <Icon d={icons.undo} /> Undo
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NewBookingSheet({ ctx, date, slots, onClose, onDone }: { ctx: AdminCtx; date: DateKey; slots: Slot[]; onClose: () => void; onDone: () => void }) {
  const s = ctx.settings;
  const [guest, setGuest] = useState<Guest>({ name: '', phone: '', email: '' });
  const [source, setSource] = useState<Exclude<BookingSource, 'online'>>('walk-in');
  const [paid, setPaid] = useState(true);
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (guest.name.trim().length < 2) return setError('Enter the guest name.');
    if (!guest.phone.trim() && !guest.email.trim()) return setError('Add a phone number or email.');
    setBusy(true);
    const g = { name: guest.name.trim(), phone: guest.phone.trim(), email: guest.email.trim() };
    try {
      if (!repeat) {
        const b = await ctx.backend.createBooking({ date, slots, guest: g, source, paid, notes: notes.trim() || undefined });
        ctx.toast.ok(`Booked · ${b.reference}`);
      } else {
        const seriesId = uid();
        const failed: string[] = [];
        for (let i = 0; i < weeks; i++) {
          const d = addDays(date, i * 7);
          await ctx.backend
            .createBooking({ date: d, slots, guest: g, source: 'recurring', paid: paid && i === 0, notes: notes.trim() || `Weekly series (${weeks} weeks)`, seriesId })
            .catch(() => failed.push(formatDate(d)));
        }
        if (failed.length) ctx.toast.error(`Booked ${weeks - failed.length} of ${weeks} weeks. Taken: ${failed.join(', ')}`);
        else ctx.toast.ok(`Booked ${weeks} weeks`);
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Sheet title="New booking" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-line p-3 text-sm">
          <p className="text-mist">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
          {describeSlots(s, slots).map((l) => (
            <p key={l}>{l}</p>
          ))}
          <p className="mt-1 font-semibold">{formatMoney(quote(s, date, slots).total, s.currencySymbol)}{repeat ? ' per week' : ''}</p>
        </div>
        <Field label="Guest name">
          <input className="input" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input className="input" type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Source">
            <select className="input" value={source} onChange={(e) => setSource(e.target.value as typeof source)} disabled={repeat}>
              <option value="walk-in">Walk-in</option>
              <option value="phone">Phone</option>
            </select>
          </Field>
          <Field label="Payment">
            <select className="input" value={paid ? 'paid' : 'unpaid'} onChange={(e) => setPaid(e.target.value === 'paid')}>
              <option value="paid">Paid (cash)</option>
              <option value="unpaid">Not yet paid</option>
            </select>
          </Field>
        </div>
        <Field label="Notes (optional)">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="rounded-2xl border border-line p-3">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-[#7cff67]" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            Repeat every week (league, club or regular group)
          </label>
          {repeat && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="text-mist">For</span>
              <input type="number" min={2} max={26} value={weeks} onChange={(e) => setWeeks(Math.min(26, Math.max(2, Number(e.target.value) || 2)))} className="input !w-20 !py-1.5" />
              <span className="text-mist">weeks. Only the first week is marked paid.</span>
            </div>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : repeat ? `Book ${weeks} weeks` : 'Save booking'}
        </button>
      </div>
    </Sheet>
  );
}

function BlockSheet({ ctx, date, slots, onClose, onDone }: { ctx: AdminCtx; date: DateKey; slots: Slot[]; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return (
    <Sheet title="Close off time" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim()) return setError('Add a reason.');
          try {
            for (const r of slotRuns(slots)) {
              const block: Omit<Block, 'id'> = { date, courtId: r.courtId, startHour: r.start, endHour: r.end, reason: reason.trim() };
              await ctx.backend.addBlock(block);
            }
            ctx.toast.ok('Time closed off');
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="rounded-2xl border border-line p-3 text-sm">
          <p className="text-mist">{formatDate(date, { weekday: 'long', month: 'long' })}</p>
          {describeSlots(ctx.settings, slots).map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <Field label="Reason" error={error}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Maintenance, private event…" autoFocus />
        </Field>
        <button className="btn btn-warn btn-block">Close off</button>
      </form>
    </Sheet>
  );
}
