import { useMemo, useState } from 'react';
import type { DateKey, Settings } from '../../../lib/booking/types';
import { addDays, dayHours, fromKey, hoursList, toKey, venueToday } from '../../../lib/booking/utils';
import { useAvailability } from './hooks';

interface Props {
  settings: Settings;
  value: DateKey;
  onChange: (d: DateKey) => void;
  /** Days to mark with a pin, e.g. the renter's own bookings. */
  markers?: Set<DateKey>;
  /** Admin can look at past dates and beyond the booking window. */
  unrestricted?: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Month view. Each day shows a small bar for how much is still free, and a
// green pin on days where the renter has a booking.
export default function MonthCalendar({ settings: s, value, onChange, markers, unrestricted }: Props) {
  const today = venueToday(s);
  const lastDay = addDays(today, s.maxDaysAhead);
  const [cursor, setCursor] = useState(() => {
    const d = fromKey(value);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const monthStart = toKey(cursor);
  const monthEnd = toKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const data = useAvailability(monthStart, monthEnd);
  const activeCourts = s.courts.filter((c) => c.active).length;

  const used = useMemo(() => {
    const m = new Map<DateKey, number>();
    if (!data) return m;
    const now = Date.now();
    for (const o of data.occupancy) {
      if (o.kind === 'held' && (o.holdExpiresAt ?? 0) <= now) continue;
      m.set(o.date, (m.get(o.date) ?? 0) + 1);
    }
    for (const bl of data.blocks) {
      const n = (bl.endHour - bl.startHour) * (bl.courtId === 'all' ? activeCourts : 1);
      m.set(bl.date, (m.get(bl.date) ?? 0) + n);
    }
    return m;
  }, [data, activeCourts]);

  const cells = useMemo(() => {
    const out: (DateKey | null)[] = Array(cursor.getDay()).fill(null);
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= days; d++) out.push(toKey(new Date(cursor.getFullYear(), cursor.getMonth(), d)));
    return out;
  }, [cursor]);

  const shift = (n: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
  const canPrev = unrestricted || monthStart > today.slice(0, 8) + '01';
  const canNext = unrestricted || monthEnd < lastDay;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-display text-lg font-semibold">
          {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <div className="flex gap-1">
          <NavBtn label="Previous month" disabled={!canPrev} onClick={() => shift(-1)} d="M15 18l-6-6 6-6" />
          <NavBtn label="Next month" disabled={!canNext} onClick={() => shift(1)} d="M9 6l6 6-6 6" />
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-mist">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="pb-2">{w}</div>
        ))}
        {cells.map((key, i) => {
          if (!key) return <div key={`e${i}`} />;
          const closed = !dayHours(s, key);
          const outOfRange = !unrestricted && (key < today || key > lastDay);
          const disabled = outOfRange || (!unrestricted && closed);
          const selected = key === value;
          const mine = markers?.has(key);
          const total = hoursList(s, key).length * activeCourts;
          const free = total ? Math.max(0, 1 - (used.get(key) ?? 0) / total) : 0;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(key)}
              aria-pressed={selected}
              aria-label={`${fromKey(key).toDateString()}${mine ? ', you have a booking' : ''}${closed ? ', closed' : ''}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition-colors ${
                selected ? 'bg-aurora font-semibold text-ink' : disabled ? 'text-white/15' : 'text-white hover:bg-white/[0.06]'
              } ${key === today && !selected ? 'ring-1 ring-inset ring-aurora/40' : ''} ${mine && !selected ? 'bg-aurora/10' : ''}`}
            >
              {fromKey(key).getDate()}
              {mine && (
                <span className={`absolute right-1 top-1 size-1.5 rounded-full ${selected ? 'bg-ink' : 'bg-aurora'}`} />
              )}
              {!disabled && data && !closed && (
                <span className={`mt-1 h-0.5 w-5 overflow-hidden rounded-full ${selected ? 'bg-ink/20' : 'bg-white/10'}`}>
                  <span className={`block h-full rounded-full ${selected ? 'bg-ink' : 'bg-aurora'}`} style={{ width: `${Math.round(free * 100)}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist">
        <span>Bar = how much of the day is free</span>
        {markers && (
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-aurora" /> Your booking
          </span>
        )}
      </div>
    </div>
  );
}

function NavBtn({ label, disabled, onClick, d }: { label: string; disabled: boolean; onClick: () => void; d: string }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="btn btn-secondary btn-sm size-9 !p-0">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}
