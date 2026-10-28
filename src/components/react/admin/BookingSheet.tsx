import { useState } from 'react';
import type { Booking, DateKey, Guest } from '../../../lib/booking/types';
import { describeSlots, formatDate, formatDateTime, formatHour, formatMoney, hoursList, quote, startHour, venueToday } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Alert, Field, Icon, Sheet, icons } from '../ui';
import { act, PaymentBadge, StatusBadge, type AdminCtx } from './shared';

type Mode = 'view' | 'edit' | 'move' | 'cancel';

export default function BookingSheet({ ctx, bookingId, initial, onClose }: { ctx: AdminCtx; bookingId: string; initial: Booking; onClose: () => void }) {
  // Keep the sheet in sync with live changes (e.g. after check-in).
  const [list] = useLive((b) => b.listBookings(initial.date, initial.date), [initial.date]);
  const [moved] = useLive((b) => (list && !list.some((x) => x.id === bookingId) ? b.listBookings() : Promise.resolve(null)), [list]);
  const b = list?.find((x) => x.id === bookingId) ?? moved?.find((x) => x.id === bookingId) ?? initial;
  const [mode, setMode] = useState<Mode>('view');

  return (
    <Sheet title={mode === 'edit' ? 'Edit booking' : mode === 'move' ? 'Reschedule' : mode === 'cancel' ? 'Cancel booking' : 'Booking'} onClose={onClose}>
      {mode === 'view' && <View ctx={ctx} b={b} setMode={setMode} />}
      {mode === 'edit' && <EditForm ctx={ctx} b={b} onDone={() => setMode('view')} />}
      {mode === 'move' && <MoveForm ctx={ctx} b={b} onDone={() => setMode('view')} />}
      {mode === 'cancel' && <CancelForm ctx={ctx} b={b} onDone={() => setMode('view')} />}
    </Sheet>
  );
}

function View({ ctx, b, setMode }: { ctx: AdminCtx; b: Booking; setMode: (m: Mode) => void }) {
  const s = ctx.settings;
  const today = venueToday(s);
  const active = b.status === 'confirmed';
  const canMark = active && b.date <= today;
  const [refund, setRefund] = useState(s.cancellation.refundPercent > 0 && b.paymentStatus === 'paid' && ctx.isOwner);

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-mist">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto font-display text-2xl font-semibold tracking-wider text-aurora">{b.reference}</p>
        <PaymentBadge b={b} />
        <StatusBadge b={b} />
      </div>

      {b.cancelRequest?.status === 'pending' && (
        <div className="mt-4 rounded-2xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm">
          <p className="font-medium text-amber-100">The renter asked to cancel</p>
          <p className="mt-1 text-amber-100/80">“{b.cancelRequest.reason}” · {formatDateTime(b.cancelRequest.at)}</p>
          {b.paymentStatus === 'paid' && ctx.isOwner && (
            <label className="mt-3 flex items-center gap-2">
              <input type="checkbox" className="size-4 accent-[#7cff67]" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
              Refund {s.cancellation.refundPercent}% ({formatMoney((b.amount * s.cancellation.refundPercent) / 100, s.currencySymbol)})
            </label>
          )}
          {b.paymentStatus === 'paid' && !ctx.isOwner && <p className="mt-2 text-xs text-amber-100/70">Only the owner can issue refunds.</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm flex-1" onClick={() => act(ctx, () => ctx.backend.resolveCancelRequest(b.id, false, false), 'Request declined')}>
              Decline
            </button>
            <button type="button" className="btn btn-danger btn-sm flex-1" onClick={() => act(ctx, () => ctx.backend.resolveCancelRequest(b.id, true, refund), 'Booking cancelled')}>
              Approve cancellation
            </button>
          </div>
        </div>
      )}

      {active && (
        <div className="mt-4 rounded-2xl border border-line p-3">
          <p className="mb-2 text-xs text-mist">{canMark ? 'Attendance' : 'Check-in opens on the day of the booking'}</p>
          {b.attendance === 'pending' ? (
            <div className="flex gap-2">
              <button type="button" disabled={!canMark} className="btn btn-primary flex-1" onClick={() => act(ctx, () => ctx.backend.setAttendance(b.id, 'checked-in'), 'Checked in')}>
                <Icon d={icons.check} /> Check in
              </button>
              <button type="button" disabled={!canMark} className="btn btn-danger-outline flex-1" onClick={() => act(ctx, () => ctx.backend.setAttendance(b.id, 'no-show'), 'Marked as no-show')}>
                No-show
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm">
                {b.attendance === 'checked-in' ? `Checked in${b.checkedInAt ? ` at ${new Date(b.checkedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}` : 'Did not show up'}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(ctx, () => ctx.backend.setAttendance(b.id, 'pending'), 'Attendance reset')}>
                <Icon d={icons.undo} /> Undo
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 divide-y divide-line">
        {row('Guest', b.guest.name)}
        {row('Phone', b.guest.phone ? <a href={`tel:${b.guest.phone}`} className="hover:text-aurora">{b.guest.phone}</a> : '—')}
        {row('Email', b.guest.email ? <a href={`mailto:${b.guest.email}`} className="hover:text-aurora">{b.guest.email}</a> : '—')}
        {row('Date', formatDate(b.date, { weekday: 'long', month: 'long' }))}
        {row('Time', describeSlots(s, b.slots).map((l) => <span key={l} className="block">{l}</span>))}
        {row('Amount', `${formatMoney(b.amount, s.currencySymbol)}${b.discountCode ? ` (code ${b.discountCode})` : ''}`)}
        {row('Source', <span className="capitalize">{b.source}</span>)}
        {row('Booked', formatDateTime(b.createdAt))}
        {b.notes && row('Notes', b.notes)}
        {b.status === 'cancelled' && row('Cancelled', `${b.cancelledAt ? formatDateTime(b.cancelledAt) : ''}${b.cancelReason ? ` · ${b.cancelReason}` : ''}`)}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {b.paymentStatus === 'unpaid' && b.status === 'confirmed' && (
          <button type="button" className="btn btn-primary col-span-2" onClick={() => act(ctx, () => ctx.backend.markPaid(b.id), 'Marked as paid')}>
            Mark as paid
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => setMode('edit')}>
          <Icon d={icons.edit} /> Edit
        </button>
        <button type="button" className="btn btn-secondary" disabled={!active} onClick={() => setMode('move')}>
          <Icon d={icons.calendar} /> Reschedule
        </button>
        <button
          type="button"
          className="btn btn-secondary col-span-2"
          disabled={b.status !== 'confirmed'}
          onClick={async () => {
            try {
              const r = await ctx.backend.resendConfirmation(b.id);
              r.sent ? ctx.toast.ok(r.message) : ctx.toast.error(r.message);
            } catch (e) {
              ctx.toast.error(e);
            }
          }}
        >
          <Icon d={icons.mail} /> Resend confirmation
        </button>
        {(b.status === 'confirmed' || b.status === 'held') && (
          <button type="button" className="btn btn-danger-outline col-span-2" onClick={() => setMode('cancel')}>
            Cancel booking
          </button>
        )}
      </div>
    </div>
  );
}

function EditForm({ ctx, b, onDone }: { ctx: AdminCtx; b: Booking; onDone: () => void }) {
  const [guest, setGuest] = useState<Guest>(b.guest);
  const [notes, setNotes] = useState(b.notes ?? '');
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act(ctx, () => ctx.backend.updateBooking(b.id, { guest, notes }), 'Booking updated')) onDone();
      }}
    >
      <Field label="Guest name">
        <input className="input" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <input className="input" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onDone}>
          Back
        </button>
        <button className="btn btn-primary flex-1">Save</button>
      </div>
    </form>
  );
}

function MoveForm({ ctx, b, onDone }: { ctx: AdminCtx; b: Booking; onDone: () => void }) {
  const s = ctx.settings;
  const [date, setDate] = useState<DateKey>(b.date);
  const [court, setCourt] = useState(b.slots[0].courtId);
  const [start, setStart] = useState(startHour(b.slots));
  const [len, setLen] = useState(b.slots.length);
  const hours = hoursList(s, date);
  const slots = Array.from({ length: len }, (_, i) => ({ courtId: court, hour: start + i }));
  const newPrice = Math.max(0, quote(s, date, slots).subtotal - (b.discountAmount ?? 0));

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act(ctx, () => ctx.backend.rescheduleBooking(b.id, date, slots), 'Booking moved')) onDone();
      }}
    >
      <p className="text-sm text-mist">Currently: {formatDate(b.date)} · {describeSlots(s, b.slots).join(', ')}</p>
      <Field label="New date">
        <input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </Field>
      <Field label="Court">
        <select className="input" value={court} onChange={(e) => setCourt(e.target.value)}>
          {s.courts.filter((c) => c.active).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start">
          <select className="input" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {hours.map((h) => (
              <option key={h} value={h}>{formatHour(h)}</option>
            ))}
          </select>
        </Field>
        <Field label="Hours">
          <select className="input" value={len} onChange={(e) => setLen(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
      </div>
      {!hours.length && <Alert tone="warn">The venue is closed on that day.</Alert>}
      {newPrice !== b.amount && (
        <Alert tone="info">
          New price {formatMoney(newPrice, s.currencySymbol)} (was {formatMoney(b.amount, s.currencySymbol)}). Settle the difference with the renter.
        </Alert>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onDone}>
          Back
        </button>
        <button className="btn btn-primary flex-1" disabled={!hours.length}>
          Move booking
        </button>
      </div>
    </form>
  );
}

function CancelForm({ ctx, b, onDone }: { ctx: AdminCtx; b: Booking; onDone: () => void }) {
  const s = ctx.settings;
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [refund, setRefund] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await act(ctx, () => ctx.backend.cancelBooking(b.id, { renterConfirmed: confirmed, refund, reason }), 'Booking cancelled')) onDone();
      }}
    >
      <Alert tone="warn">Only cancel once the renter has confirmed they want to cancel. The slot is freed up straight away.</Alert>
      <p className="text-sm">
        {b.guest.name} · {formatDate(b.date)} · {describeSlots(s, b.slots).join(', ')}
      </p>
      <Field label="Reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Renter called to cancel" />
      </Field>
      <label className="flex items-start gap-3 rounded-2xl border border-line p-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[#7cff67]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        The renter confirmed this cancellation
      </label>
      {b.paymentStatus === 'paid' &&
        (ctx.isOwner ? (
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-[#7cff67]" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
            Mark as refunded ({formatMoney((b.amount * s.cancellation.refundPercent) / 100, s.currencySymbol)}, {s.cancellation.refundPercent}%)
          </label>
        ) : (
          <p className="text-xs text-mist">This booking was paid. Only the owner can issue a refund.</p>
        ))}
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1" onClick={onDone}>
          Keep booking
        </button>
        <button className="btn btn-danger flex-1" disabled={!confirmed}>
          Cancel booking
        </button>
      </div>
    </form>
  );
}
