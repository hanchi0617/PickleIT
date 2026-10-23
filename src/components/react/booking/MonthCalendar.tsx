import { useMemo, useState } from 'react';
import { booking } from '../../../config/site';
import type { DateKey } from '../../../lib/booking/types';
import { addDays, fromKey, hours, isActive, toKey, todayKey } from '../../../lib/booking/utils';
import { useRange } from './hooks';

interface Props {
  value: DateKey;
  onChange: (d: DateKey) => void;
  /** Admin can look at past dates and beyond the booking window. */
  unrestricted?: boolean;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Month view. Each day shows a small bar for how much is still free, so
// guests can spot open days at a glance.
export default function MonthCalendar({ value, onChange, unrestricted }: Props) {
  const today = todayKey();
  const lastDay = addDays(today, booking.maxDaysAhead);
  const [cursor, setCursor] = useState(() => {
    const d = fromKey(value);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const monthStart = toKey(cursor);
  const monthEnd = toKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const data = useRange(monthStart, monthEnd);

  const freeByDay = useMemo(() => {
    const total = hours.length * booking.courts.length;
    const used = new Map<DateKey, number>();
    if (!data) return { used, total };
    const now = Date.now();
    for (const b of data.bookings) {
      if (isActive(b, now)) used.set(b.date, (used.get(b.date) ?? 0) + b.slots.length);
    }
    for (const bl of data.blocks) {
      const n = (bl.endHour - bl.startHour) * (bl.courtId === 'all' ? booking.courts.length : 1);
      used.set(bl.date, (used.get(bl.date) ?? 0) + n);
    }
    return { used, total };
  }, [data]);

  const cells = useMemo(() => {
    const first = cursor.getDay();
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const out: (DateKey | null)[] = Array(first).fill(null);
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
          const disabled = !unrestricted && (key < today || key > lastDay);
          const selected = key === value;
          const used = freeByDay.used.get(key) ?? 0;
          const free = Math.max(0, 1 - used / freeByDay.total);
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onChange(key)}
              aria-pressed={selected}
              aria-label={fromKey(key).toDateString()}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition ${
                selected
                  ? 'bg-aurora font-semibold text-ink'
                  : disabled
                    ? 'text-white/15'
                    : 'text-white hover:bg-white/[0.06]'
              } ${key === today && !selected ? 'ring-1 ring-inset ring-aurora/40' : ''}`}
            >
              {fromKey(key).getDate()}
              {!disabled && data && (
                <span className={`mt-1 h-0.5 w-5 overflow-hidden rounded-full ${selected ? 'bg-ink/20' : 'bg-white/10'}`}>
                  <span
                    className={`block h-full rounded-full ${selected ? 'bg-ink' : 'bg-aurora'}`}
                    style={{ width: `${Math.round(free * 100)}%` }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-mist">Green bar shows how much of the day is still free.</p>
    </div>
  );
}

function NavBtn({ label, disabled, onClick, d }: { label: string; disabled: boolean; onClick: () => void; d: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full border border-line text-mist transition hover:border-white/25 hover:text-white disabled:opacity-30 disabled:hover:border-line"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}
