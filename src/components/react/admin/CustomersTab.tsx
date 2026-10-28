import { useMemo, useState } from 'react';
import type { Booking, CustomerNote, Guest } from '../../../lib/booking/types';
import { customerKey, formatMoney } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Badge, Field, Icon, Sheet, Spinner, icons } from '../ui';
import { act, BookingRow, downloadCsv, EmptyState, type AdminCtx } from './shared';

interface Customer {
  key: string;
  guest: Guest;
  bookings: Booking[];
  visits: number;
  noShows: number;
  cancelled: number;
  spent: number;
  lastDate: string;
  note?: CustomerNote;
}

// Everyone who has booked, grouped by phone number (or email), with history,
// no-show count and private staff notes.
export default function CustomersTab({ ctx }: { ctx: AdminCtx }) {
  const [bookings] = useLive((b) => b.listBookings(), []);
  const [notes] = useLive((b) => b.listCustomerNotes(), []);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'recent' | 'visits' | 'spent' | 'noShows'>('recent');
  const [open, setOpen] = useState<string | null>(null);

  const customers = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const b of bookings ?? []) {
      if (b.status === 'expired' || b.status === 'held') continue;
      const key = customerKey(b.guest);
      if (!key) continue;
      const c = map.get(key) ?? { key, guest: b.guest, bookings: [], visits: 0, noShows: 0, cancelled: 0, spent: 0, lastDate: '' };
      c.bookings.push(b);
      if (b.date >= c.lastDate) {
        c.lastDate = b.date;
        c.guest = b.guest;
      }
      if (b.status === 'cancelled') c.cancelled++;
      else {
        if (b.attendance === 'checked-in') c.visits++;
        if (b.attendance === 'no-show') c.noShows++;
      }
      if (b.paymentStatus === 'paid') c.spent += b.amount;
      map.set(key, c);
    }
    for (const n of notes ?? []) {
      const c = map.get(n.key);
      if (c) c.note = n;
    }
    return [...map.values()];
  }, [bookings, notes]);

  if (!bookings || !notes) return <Spinner />;

  const needle = q.trim().toLowerCase();
  const list = customers
    .filter((c) => !needle || [c.guest.name, c.guest.phone, c.guest.email].some((v) => v.toLowerCase().includes(needle)))
    .sort((a, z) =>
      sort === 'visits' ? z.visits - a.visits : sort === 'spent' ? z.spent - a.spent : sort === 'noShows' ? z.noShows - a.noShows : z.lastDate.localeCompare(a.lastDate),
    );
  const current = open ? customers.find((c) => c.key === open) : null;
  const sym = ctx.settings.currencySymbol;

  return (
    <section className="card p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers" className="input flex-1" />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="input sm:!w-48">
          <option value="recent">Most recent</option>
          <option value="visits">Most visits</option>
          <option value="spent">Most spent</option>
          <option value="noShows">Most no-shows</option>
        </select>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            downloadCsv('customers.csv', [
              ['Name', 'Phone', 'Email', 'Bookings', 'Visits', 'No-shows', 'Cancelled', 'Spent', 'Last booking', 'Flagged', 'Notes'],
              ...list.map((c) => [c.guest.name, c.guest.phone, c.guest.email, c.bookings.length, c.visits, c.noShows, c.cancelled, c.spent, c.lastDate, c.note?.flagged ? 'yes' : '', c.note?.notes ?? '']),
            ])
          }
        >
          <Icon d={icons.download} /> CSV
        </button>
      </div>
      <p className="mb-2 text-xs text-mist">{list.length} customer{list.length === 1 ? '' : 's'}</p>

      {list.length === 0 ? (
        <EmptyState>No customers yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 300).map((c) => (
            <li key={c.key}>
              <button type="button" onClick={() => setOpen(c.key)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-3 text-left hover:text-aurora">
                <span className="min-w-[10rem] flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    {c.guest.name} {c.note?.flagged && <Badge tone="red">Flagged</Badge>}
                  </span>
                  <span className="block text-xs text-mist">{c.guest.phone || c.guest.email}</span>
                </span>
                <span className="w-20 text-sm tabular-nums">
                  {c.visits} <span className="text-xs text-mist">visits</span>
                </span>
                <span className={`w-24 text-sm tabular-nums ${c.noShows ? 'text-rose-300' : ''}`}>
                  {c.noShows} <span className="text-xs text-mist">no-show{c.noShows === 1 ? '' : 's'}</span>
                </span>
                <span className="w-24 text-right text-sm tabular-nums">{formatMoney(c.spent, sym)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {current && <CustomerSheet ctx={ctx} c={current} onClose={() => setOpen(null)} />}
    </section>
  );
}

function CustomerSheet({ ctx, c, onClose }: { ctx: AdminCtx; c: Customer; onClose: () => void }) {
  const [notes, setNotes] = useState(c.note?.notes ?? '');
  const [flagged, setFlagged] = useState(c.note?.flagged ?? false);
  const history = [...c.bookings].sort((a, z) => z.date.localeCompare(a.date));

  return (
    <Sheet title={c.guest.name} onClose={onClose} wide>
      <p className="text-sm text-mist">
        {c.guest.phone && <a href={`tel:${c.guest.phone}`} className="hover:text-aurora">{c.guest.phone}</a>}
        {c.guest.phone && c.guest.email && ' · '}
        {c.guest.email}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Bookings', c.bookings.length],
          ['Visits', c.visits],
          ['No-shows', c.noShows],
          ['Spent', formatMoney(c.spent, ctx.settings.currencySymbol)],
        ].map(([l, v]) => (
          <div key={l} className="rounded-2xl border border-line p-3">
            <p className="text-xs text-mist">{l}</p>
            <p className="font-display text-xl font-semibold">{v}</p>
          </div>
        ))}
      </div>

      <form
        className="mt-5 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await act(ctx, () => ctx.backend.saveCustomerNote({ key: c.key, notes, flagged }), 'Notes saved');
        }}
      >
        <Field label="Staff notes (private)">
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Prefers evenings, plays doubles…" />
        </Field>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[#7cff67]" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
          Flag this customer (e.g. repeated no-shows)
        </label>
        <button className="btn btn-secondary btn-sm">Save notes</button>
      </form>

      <h3 className="mt-6 font-display text-lg font-semibold">History</h3>
      <ul className="divide-y divide-line">
        {history.map((b) => (
          <BookingRow
            key={b.id}
            ctx={{
              ...ctx,
              openBooking: (x) => {
                onClose();
                ctx.openBooking(x);
              },
            }}
            b={b}
          />
        ))}
      </ul>
    </Sheet>
  );
}
