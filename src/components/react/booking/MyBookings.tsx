import { useEffect, useMemo, useState } from 'react';
import type { Backend } from '../../../lib/booking/api';
import { getMyBookings, onMyBookingsChange, removeMyBooking, saveMyBooking, updateMyBooking, type MyBooking } from '../../../lib/booking/myBookings';
import type { DateKey, Settings } from '../../../lib/booking/types';
import { canRequestCancel, endHour, formatDate, formatMoney, hoursUntil, startHour } from '../../../lib/booking/utils';
import { Alert, Badge, Field, Icon, Sheet, icons } from '../ui';
import CourtMarker from './CourtMarker';
import ReminderActions from './ReminderActions';

export function useMyBookings() {
  const [list, setList] = useState<MyBooking[]>([]);
  useEffect(() => {
    const load = () => setList(getMyBookings());
    load();
    return onMyBookingsChange(load);
  }, []);
  return list;
}

/** The renter's bookings saved on this device, with reminders and cancellation requests. */
export default function MyBookings({
  backend,
  settings,
  onShow,
}: {
  backend: Backend;
  settings: Settings;
  onShow: (date: DateKey) => void;
}) {
  const list = useMyBookings();
  const [cancelling, setCancelling] = useState<MyBooking | null>(null);
  const [showPast, setShowPast] = useState(false);

  // Refresh statuses from the server (the venue may have confirmed a cancellation, checked them in, ...).
  useEffect(() => {
    for (const b of getMyBookings()) {
      backend.findBooking(b.reference, b.contact).then((v) => v && updateMyBooking(v)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { upcoming, past } = useMemo(() => {
    const sorted = [...list].filter((b) => b.status !== 'expired' && b.status !== 'held').sort((a, b) => a.date.localeCompare(b.date) || startHour(a.slots) - startHour(b.slots));
    const isUpcoming = (b: MyBooking) => b.status === 'confirmed' && hoursUntil(settings, b.date, endHour(b.slots)) > 0;
    return { upcoming: sorted.filter(isUpcoming), past: sorted.filter((b) => !isUpcoming(b)).reverse() };
  }, [list, settings]);

  return (
    <div id="my-bookings" className="scroll-mt-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">My bookings</h2>
          <p className="mt-1 text-sm text-mist">Saved on this device. Your courts are pinned in green on the calendar.</p>
        </div>
      </div>

      {upcoming.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-mist">
          No upcoming bookings on this device yet.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {upcoming.map((b) => (
          <BookingCard key={b.id} b={b} settings={settings} onShow={onShow} onCancel={() => setCancelling(b)} />
        ))}
      </div>

      {past.length > 0 && (
        <div className="mt-6">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Hide' : 'Show'} past and cancelled ({past.length})
          </button>
          {showPast && (
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
              {past.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="flex-1">
                    {formatDate(b.date)} · <span className="text-mist">{b.reference}</span>
                  </span>
                  <StatusBadge b={b} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeMyBooking(b.id)} aria-label="Remove from this device">
                    <Icon d={icons.x} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <FindBooking backend={backend} />

      {cancelling && (
        <CancelRequestSheet backend={backend} settings={settings} booking={cancelling} onClose={() => setCancelling(null)} />
      )}
    </div>
  );
}

function StatusBadge({ b }: { b: MyBooking }) {
  if (b.status === 'cancelled') return <Badge tone="dim">Cancelled</Badge>;
  if (b.attendance === 'checked-in') return <Badge tone="green">Checked in</Badge>;
  if (b.attendance === 'no-show') return <Badge tone="red">Missed</Badge>;
  if (b.cancelRequest?.status === 'pending') return <Badge tone="amber">Cancellation requested</Badge>;
  if (b.cancelRequest?.status === 'declined') return <Badge tone="neutral">Cancellation declined</Badge>;
  if (b.status === 'confirmed') return <Badge tone="green">Confirmed</Badge>;
  return <Badge tone="neutral">{b.status}</Badge>;
}

function BookingCard({ b, settings, onShow, onCancel }: { b: MyBooking; settings: Settings; onShow: (d: DateKey) => void; onCancel: () => void }) {
  const until = hoursUntil(settings, b.date, startHour(b.slots));
  const when = until <= 0 ? 'Happening now' : until < 24 ? `In ${Math.max(1, Math.round(until))} hour${Math.round(until) === 1 ? '' : 's'}` : null;
  return (
    <article className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">{formatDate(b.date, { weekday: 'long', month: 'long' })}</p>
          <p className="text-sm text-mist">
            {b.reference} · {formatMoney(b.amount, settings.currencySymbol)}
          </p>
        </div>
        <StatusBadge b={b} />
      </div>
      {when && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-aurora/10 px-3 py-2 text-sm text-aurora">
          <Icon d={icons.bell} /> {when}
        </p>
      )}
      <div className="mt-4">
        <CourtMarker settings={settings} slots={b.slots} compact />
      </div>
      <div className="mt-4">
        <ReminderActions settings={settings} booking={b} size="sm" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShow(b.date)}>
          <Icon d={icons.pin} /> Show on calendar
        </button>
        {b.cancelRequest?.status !== 'pending' && (
          <button type="button" className="btn btn-ghost btn-sm text-rose-200" onClick={onCancel}>
            Request cancellation
          </button>
        )}
      </div>
    </article>
  );
}

function CancelRequestSheet({ backend, settings, booking, onClose }: { backend: Backend; settings: Settings; booking: MyBooking; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const check = canRequestCancel(settings, booking);
  const { minHoursBefore, refundPercent } = settings.cancellation;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const v = await backend.requestCancellation(booking.reference, booking.contact, reason);
      updateMyBooking(v);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Sheet title="Cancel booking" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">
            Your request was sent. The venue will confirm the cancellation and contact you about any refund.
          </Alert>
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      ) : !check.ok ? (
        <div className="space-y-4">
          <Alert tone="warn">{check.reason}</Alert>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-mist">
            {formatDate(booking.date, { weekday: 'long', month: 'long' })} · {booking.reference}
          </p>
          <Alert tone="info">
            Requests must be made at least {minHoursBefore} hours before your booking.
            {refundPercent > 0 ? ` Approved cancellations get a ${refundPercent}% refund.` : ' Bookings are not refundable.'} The venue
            confirms every cancellation.
          </Alert>
          <Field label="Reason (optional)">
            <textarea className="input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#7cff67]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm I want to cancel this booking.
          </label>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary flex-1" onClick={onClose}>
              Keep booking
            </button>
            <button type="button" className="btn btn-danger flex-1" disabled={!confirmed || busy} onClick={submit}>
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function FindBooking({ backend }: { backend: Backend }) {
  const [ref, setRef] = useState('');
  const [contact, setContact] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <details className="mt-8 rounded-2xl border border-line p-5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none font-medium">
        Booked on another device? <span className="text-aurora">Find your booking</span>
      </summary>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg(null);
          const v = await backend.findBooking(ref, contact).catch(() => null);
          if (!v) return setMsg({ ok: false, text: 'No booking found with that reference and email or mobile number.' });
          saveMyBooking({ ...v, contact, savedAt: Date.now() });
          setMsg({ ok: true, text: `Found ${v.reference}. It's now saved on this device.` });
          setRef('');
        }}
      >
        <input className="input uppercase" placeholder="Reference, e.g. PI-ABC234" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Booking reference" />
        <input className="input" placeholder="Email or mobile used" value={contact} onChange={(e) => setContact(e.target.value)} aria-label="Email or mobile number" />
        <button className="btn btn-secondary">Find</button>
      </form>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-aurora' : 'text-rose-300'}`}>{msg.text}</p>}
    </details>
  );
}
