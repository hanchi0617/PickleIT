import type { WaitlistStatus } from '../../../lib/booking/types';
import { courtName, formatDate, formatDateTime, formatHour, venueToday } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Badge, Spinner } from '../ui';
import { act, BookingRow, EmptyState, type AdminCtx } from './shared';

// Things waiting on staff: renters asking to cancel, and people on the waitlist.
export default function RequestsTab({ ctx }: { ctx: AdminCtx }) {
  const today = venueToday(ctx.settings);
  const [bookings] = useLive((b) => b.listBookings(), []);
  const [waitlist] = useLive((b) => b.listWaitlist(today), [today]);

  if (!bookings || !waitlist) return <Spinner />;

  const requests = bookings.filter((b) => b.cancelRequest?.status === 'pending').sort((a, z) => a.date.localeCompare(z.date));
  const open = waitlist.filter((w) => w.status === 'waiting' || w.status === 'contacted').sort((a, z) => a.date.localeCompare(z.date) || a.hour - z.hour);

  const setStatus = (id: string, status: WaitlistStatus, msg: string) => act(ctx, () => ctx.backend.updateWaitlist(id, status), msg);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-4 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Cancellation requests</h2>
        <p className="mt-1 text-sm text-mist">Renters who asked to cancel. Open one to approve or decline.</p>
        {requests.length === 0 ? (
          <EmptyState>No pending requests.</EmptyState>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {requests.map((b) => (
              <BookingRow
                key={b.id}
                ctx={ctx}
                b={b}
                extra={<p className="w-full text-xs text-amber-200/80">“{b.cancelRequest!.reason}” · asked {formatDateTime(b.cancelRequest!.at)}</p>}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4 sm:p-6">
        <h2 className="font-display text-xl font-semibold">Waitlist</h2>
        <p className="mt-1 text-sm text-mist">People who want a fully booked hour. Contact them when a slot frees up.</p>
        {open.length === 0 ? (
          <EmptyState>Nobody is waiting.</EmptyState>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {open.map((w) => (
              <li key={w.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{w.guest.name}</p>
                    <p className="text-xs text-mist">
                      {w.guest.phone && <a href={`tel:${w.guest.phone}`} className="hover:text-aurora">{w.guest.phone}</a>}
                      {w.guest.phone && w.guest.email && ' · '}
                      {w.guest.email}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{formatDate(w.date)} · {formatHour(w.hour)}</p>
                    <p className="text-xs text-mist">{w.courtId ? courtName(ctx.settings, w.courtId) : 'Any court'}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {w.status === 'contacted' ? <Badge tone="blue">Contacted</Badge> : <Badge tone="amber">Waiting</Badge>}
                  <span className="flex-1" />
                  {w.status === 'waiting' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(w.id, 'contacted', 'Marked as contacted')}>
                      Contacted
                    </button>
                  )}
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setStatus(w.id, 'booked', 'Marked as booked')}>
                    Booked
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStatus(w.id, 'removed', 'Removed from waitlist')}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
