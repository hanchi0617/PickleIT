import { useState } from 'react';
import { courtName, formatDate, formatHour, venueToday } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Field, Spinner } from '../ui';
import { act, EmptyState, type AdminCtx } from './shared';

export default function ClosuresTab({ ctx }: { ctx: AdminCtx }) {
  const s = ctx.settings;
  const today = venueToday(s);
  const [blocks] = useLive((b) => b.listBlocks(today, '9999-12-31'), [today]);
  const open = s.hours[0]?.open ?? 6;
  const [form, setForm] = useState({ date: today, courtId: 'all', startHour: open, endHour: open + 2, reason: '' });

  const hourOptions = (from: number, to: number) => {
    const out = [];
    for (let h = from; h <= to; h++) out.push(<option key={h} value={h}>{formatHour(h)}</option>);
    return out;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="card p-4 sm:p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">Upcoming closures</h2>
        {!blocks ? (
          <Spinner />
        ) : blocks.length === 0 ? (
          <EmptyState>No closures scheduled.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {[...blocks]
              .sort((a, z) => a.date.localeCompare(z.date) || a.startHour - z.startHour)
              .map((b) => (
                <li key={b.id} className="flex items-center gap-4 py-3">
                  <div className="flex-1">
                    <p className="font-medium">{b.reason}</p>
                    <p className="text-sm text-mist">
                      {formatDate(b.date)} · {courtName(s, b.courtId)} · {formatHour(b.startHour)} – {formatHour(b.endHour)}
                    </p>
                  </div>
                  <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => act(ctx, () => ctx.backend.removeBlock(b.id), 'Closure removed')}>
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-mist">Whole-day closures and holidays are set by the owner in Settings → Opening hours.</p>
      </section>

      <section className="card p-4 sm:p-6">
        <h2 className="mb-4 font-display text-xl font-semibold">Close off time</h2>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(ctx, () => ctx.backend.addBlock({ ...form, reason: form.reason.trim() }), 'Closure added')) setForm({ ...form, reason: '' });
          }}
        >
          <Field label="Date">
            <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Court">
            <select className="input" value={form.courtId} onChange={(e) => setForm({ ...form, courtId: e.target.value })}>
              <option value="all">All courts</option>
              {s.courts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <select className="input" value={form.startHour} onChange={(e) => setForm({ ...form, startHour: Number(e.target.value) })}>
                {hourOptions(0, 23)}
              </select>
            </Field>
            <Field label="Until">
              <select className="input" value={form.endHour} onChange={(e) => setForm({ ...form, endHour: Number(e.target.value) })}>
                {hourOptions(1, 24)}
              </select>
            </Field>
          </div>
          <Field label="Reason">
            <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Maintenance, tournament…" />
          </Field>
          <p className="text-xs text-mist">Existing bookings in this time are not cancelled automatically.</p>
          <button className="btn btn-warn btn-block">Add closure</button>
        </form>
      </section>
    </div>
  );
}
