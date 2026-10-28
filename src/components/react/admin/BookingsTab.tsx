import { useState } from 'react';
import type { Booking } from '../../../lib/booking/types';
import { isActiveBooking, startHour, venueToday } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Icon, Spinner, icons } from '../ui';
import { BookingRow, bookingsCsv, downloadCsv, EmptyState, type AdminCtx } from './shared';

type Filter = 'upcoming' | 'today' | 'unpaid' | 'checked-in' | 'no-show' | 'cancelled' | 'all';

export default function BookingsTab({ ctx }: { ctx: AdminCtx }) {
  const [all] = useLive((b) => b.listBookings(), []);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('upcoming');
  const today = venueToday(ctx.settings);

  if (!all) return <Spinner />;

  const test = (b: Booking) => {
    switch (filter) {
      case 'upcoming':
        return b.date >= today && isActiveBooking(b);
      case 'today':
        return b.date === today && b.status !== 'expired';
      case 'unpaid':
        return b.status === 'confirmed' && b.paymentStatus === 'unpaid';
      case 'checked-in':
      case 'no-show':
        return b.status === 'confirmed' && b.attendance === filter;
      case 'cancelled':
        return b.status === 'cancelled';
      default:
        return true;
    }
  };

  const needle = q.trim().toLowerCase();
  const list = all
    .filter(test)
    .filter((b) => !needle || [b.reference, b.guest.name, b.guest.phone, b.guest.email].some((v) => v.toLowerCase().includes(needle)))
    .sort((a, z) =>
      filter === 'upcoming' || filter === 'today'
        ? a.date.localeCompare(z.date) || startHour(a.slots) - startHour(z.slots)
        : z.date.localeCompare(a.date) || z.createdAt - a.createdAt,
    );

  return (
    <section className="card p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email or reference" className="input flex-1" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="input sm:!w-48">
          <option value="upcoming">Upcoming</option>
          <option value="today">Today</option>
          <option value="unpaid">Unpaid</option>
          <option value="checked-in">Checked in</option>
          <option value="no-show">No-shows</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </select>
        <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(`bookings-${filter}-${today}.csv`, bookingsCsv(ctx.settings, list))}>
          <Icon d={icons.download} /> CSV
        </button>
      </div>
      <p className="mb-2 text-xs text-mist">{list.length} booking{list.length === 1 ? '' : 's'}</p>
      {list.length === 0 ? (
        <EmptyState>No bookings match.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 300).map((b) => (
            <BookingRow key={b.id} ctx={ctx} b={b} />
          ))}
        </ul>
      )}
      {list.length > 300 && <p className="mt-3 text-xs text-mist">Showing the first 300. Search or export to CSV to see the rest.</p>}
    </section>
  );
}
