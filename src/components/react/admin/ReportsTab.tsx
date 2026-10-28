import { useMemo, useState } from 'react';
import type { Booking } from '../../../lib/booking/types';
import { addDays, daysBetween, formatDate, formatHour, formatMoney, fromKey, hoursList, venueToday } from '../../../lib/booking/utils';
import { useLive } from '../booking/hooks';
import { Icon, Spinner, icons } from '../ui';
import { bookingsCsv, downloadCsv, type AdminCtx } from './shared';

type Range = '7' | '30' | '90' | 'month' | 'custom';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ReportsTab({ ctx }: { ctx: AdminCtx }) {
  const s = ctx.settings;
  const today = venueToday(s);
  const [range, setRange] = useState<Range>('30');
  const [custom, setCustom] = useState({ from: addDays(today, -30), to: today });

  const { from, to } = useMemo(() => {
    if (range === 'custom') return custom;
    if (range === 'month') return { from: today.slice(0, 8) + '01', to: today };
    return { from: addDays(today, -Number(range) + 1), to: today };
  }, [range, custom, today]);

  const [list] = useLive((b) => b.listBookings(from, to), [from, to]);

  const r = useMemo(() => (list ? compute(ctx, list, from, to) : null), [list, from, to, ctx]);
  const sym = s.currencySymbol;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['7', 'Last 7 days'],
            ['30', 'Last 30 days'],
            ['90', 'Last 90 days'],
            ['month', 'This month'],
            ['custom', 'Custom'],
          ] as [Range, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={range === id} className={`btn btn-sm ${range === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRange(id)}>
            {label}
          </button>
        ))}
        {range === 'custom' && (
          <span className="flex items-center gap-2">
            <input type="date" className="input !w-auto !py-1.5 text-sm" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            <span className="text-mist">to</span>
            <input type="date" className="input !w-auto !py-1.5 text-sm" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </span>
        )}
        <span className="flex-1" />
        {list && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadCsv(`bookings-${from}-to-${to}.csv`, bookingsCsv(s, list))}>
            <Icon d={icons.download} /> Export CSV
          </button>
        )}
      </div>

      {!r ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Paid revenue" value={formatMoney(r.revenue, sym)} sub={`${formatMoney(r.unpaid, sym)} unpaid`} />
            <Tile label="Bookings" value={String(r.bookings)} sub={`${r.hours} court-hours`} />
            <Tile label="Court usage" value={`${r.utilization}%`} sub="of open hours booked" />
            <Tile label="No-show rate" value={`${r.noShowRate}%`} sub={`${r.cancelled} cancelled`} />
          </div>

          <Chart title="Revenue per day" caption={`Paid bookings, ${formatDate(from)} – ${formatDate(to)}`}>
            <Bars
              data={r.byDay.map((d) => ({ key: d.date, label: fromKey(d.date).getDate().toString(), value: d.revenue, tip: `${formatDate(d.date)} · ${formatMoney(d.revenue, sym)} · ${d.count} booking${d.count === 1 ? '' : 's'}` }))}
              format={(v) => formatMoney(v, sym)}
            />
          </Chart>

          <div className="grid gap-6 lg:grid-cols-2">
            <Chart title="Usage by court" caption="Share of open hours that were booked">
              <ul className="space-y-4">
                {r.byCourt.map((c) => (
                  <li key={c.id}>
                    <div className="mb-1.5 flex justify-between text-sm">
                      <span>{c.name}</span>
                      <span className="tabular-nums text-mist">
                        {c.pct}% · {formatMoney(c.revenue, sym)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06]" title={`${c.name}: ${c.hours} of ${c.capacity} hours booked`}>
                      <div className="h-full rounded-full bg-aurora" style={{ width: `${c.pct}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Chart>

            <Chart title="Busiest times" caption="Booked court-hours by weekday and hour. Darker = quieter.">
              <Heatmap grid={r.heat} hours={r.heatHours} />
            </Chart>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Chart title="How people book" caption="Confirmed bookings by source">
              <Breakdown rows={r.bySource} />
            </Chart>
            <Chart title="Top discount codes" caption="Bookings that used a code">
              {r.byCode.length ? <Breakdown rows={r.byCode} /> : <p className="py-6 text-center text-sm text-mist">No discount codes used in this period.</p>}
            </Chart>
          </div>
        </>
      )}
    </div>
  );
}

function compute(ctx: AdminCtx, list: Booking[], from: string, to: string) {
  const s = ctx.settings;
  const confirmed = list.filter((b) => b.status === 'confirmed');
  const paid = confirmed.filter((b) => b.paymentStatus === 'paid');
  const days = Math.max(1, daysBetween(from, to) + 1);

  // Capacity: open hours per day × active courts.
  let openHours = 0;
  const capacityByDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const n = hoursList(s, d).length;
    capacityByDay.set(d, n);
    openHours += n;
  }
  const active = s.courts.filter((c) => c.active);
  const hours = confirmed.reduce((x, b) => x + b.slots.length, 0);
  const noShows = confirmed.filter((b) => b.attendance === 'no-show').length;
  const attended = confirmed.filter((b) => b.attendance !== 'pending').length;

  const byDay = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const day = paid.filter((b) => b.date === date);
    return { date, revenue: day.reduce((x, b) => x + b.amount, 0), count: day.length };
  });

  const byCourt = s.courts.map((c) => {
    const h = confirmed.reduce((x, b) => x + b.slots.filter((y) => y.courtId === c.id).length, 0);
    const revenue = paid.reduce((x, b) => x + (b.amount * b.slots.filter((y) => y.courtId === c.id).length) / b.slots.length, 0);
    return { id: c.id, name: c.name, hours: h, capacity: openHours, revenue: Math.round(revenue), pct: openHours ? Math.round((h / openHours) * 100) : 0 };
  });

  const heatHours = [...new Set(s.hours.flatMap((h) => (h.closed ? [] : Array.from({ length: h.close - h.open }, (_, i) => h.open + i))))].sort((a, z) => a - z);
  const heat = WEEKDAYS.map(() => new Map<number, number>());
  for (const b of confirmed) {
    const wd = fromKey(b.date).getDay();
    for (const x of b.slots) heat[wd].set(x.hour, (heat[wd].get(x.hour) ?? 0) + 1);
  }

  const count = (key: (b: Booking) => string | undefined) => {
    const m = new Map<string, number>();
    for (const b of confirmed) {
      const k = key(b);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, z) => z.value - a.value);
  };

  return {
    revenue: paid.reduce((x, b) => x + b.amount, 0),
    unpaid: confirmed.filter((b) => b.paymentStatus === 'unpaid').reduce((x, b) => x + b.amount, 0),
    bookings: confirmed.length,
    hours,
    utilization: openHours && active.length ? Math.round((hours / (openHours * active.length)) * 100) : 0,
    noShowRate: attended ? Math.round((noShows / attended) * 100) : 0,
    cancelled: list.filter((b) => b.status === 'cancelled').length,
    byDay,
    byCourt,
    heat,
    heatHours,
    bySource: count((b) => b.source.replace('-', ' ')),
    byCode: count((b) => b.discountCode).slice(0, 6),
  };
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card !rounded-2xl p-4">
      <p className="text-xs text-mist">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-mist">{sub}</p>}
    </div>
  );
}

function Chart({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-6">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mb-5 text-xs text-mist">{caption}</p>
      {children}
    </section>
  );
}

/** Single-series column chart with a hover tooltip on each bar. */
function Bars({ data, format }: { data: { key: string; label: string; value: number; tip: string }[]; format: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = Math.ceil(data.length / 15); // thin out x labels on long ranges
  const h = hover != null ? data[hover] : null;

  return (
    <div>
      <div className="mb-2 h-5 text-sm">{h ? <span>{h.tip}</span> : <span className="text-mist">Peak {format(max)} · hover a bar for details</span>}</div>
      <div className="relative">
        {/* Recessive guide lines at 0, 50%, 100% */}
        {[0, 0.5, 1].map((f) => (
          <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-white/[0.06]" style={{ bottom: `${f * 100}%` }} />
        ))}
        <div className="flex h-44 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => (
            <button
              key={d.key}
              type="button"
              aria-label={d.tip}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(i)}
              className="group flex h-full min-w-0 flex-1 items-end outline-none"
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-[#a3ff93]' : 'bg-aurora'}`}
                style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[10px] text-mist">
        {data.map((d, i) => (
          <span key={d.key} className="min-w-0 flex-1 text-center">
            {i % step === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Weekday × hour grid, one green hue from dim (quiet) to bright (busy). */
function Heatmap({ grid, hours }: { grid: Map<number, number>[]; hours: number[] }) {
  const max = Math.max(1, ...grid.flatMap((m) => [...m.values()]));
  const [tip, setTip] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-2 h-5 text-sm">{tip ?? <span className="text-mist">Hover a cell for details</span>}</div>
      <div className="overflow-x-auto">
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(14px, 1fr))` }} onMouseLeave={() => setTip(null)}>
          {grid.map((m, wd) => (
            <Row key={wd}>
              <span className="pr-1 text-right text-[11px] leading-5 text-mist">{WEEKDAYS[wd]}</span>
              {hours.map((h) => {
                const v = m.get(h) ?? 0;
                const t = `${WEEKDAYS[wd]} ${formatHour(h)} · ${v} court-hour${v === 1 ? '' : 's'}`;
                return (
                  <button
                    key={h}
                    type="button"
                    aria-label={t}
                    onMouseEnter={() => setTip(t)}
                    onFocus={() => setTip(t)}
                    className="h-5 rounded-[3px] outline-none focus-visible:ring-1 focus-visible:ring-white"
                    style={{ background: v ? `rgb(124 255 103 / ${0.12 + 0.88 * (v / max)})` : 'rgb(255 255 255 / 0.04)' }}
                  />
                );
              })}
            </Row>
          ))}
          <span />
          {hours.map((h, i) => (
            <span key={h} className="text-center text-[10px] text-mist">
              {i % 3 === 0 ? formatHour(h).replace('AM', 'a').replace('PM', 'p') : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <>{children}</>;

function Breakdown({ rows }: { rows: { label: string; value: number }[] }) {
  const total = rows.reduce((x, r) => x + r.value, 0) || 1;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="capitalize">{r.label}</span>
            <span className="tabular-nums text-mist">
              {r.value} · {Math.round((r.value / total) * 100)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-aurora" style={{ width: `${(r.value / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

