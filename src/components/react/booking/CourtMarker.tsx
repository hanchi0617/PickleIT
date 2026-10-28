import type { Settings, Slot } from '../../../lib/booking/types';
import { formatRange, slotRuns } from '../../../lib/booking/utils';
import { Icon, icons } from '../ui';

// A small map of the venue's courts with the renter's court(s) highlighted
// and their time pinned on top, so there's no doubt which court and when.
export default function CourtMarker({ settings, slots, compact }: { settings: Settings; slots: Slot[]; compact?: boolean }) {
  const runs = slotRuns(slots);
  const courts = settings.courts.filter((c) => c.active || runs.some((r) => r.courtId === c.id));

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${courts.length}, minmax(0, 1fr))` }}
      role="img"
      aria-label={`Your booking: ${runs.map((r) => `${courts.find((c) => c.id === r.courtId)?.name} ${formatRange(r.start, r.end)}`).join(', ')}`}
    >
      {courts.map((c) => {
        const mine = runs.filter((r) => r.courtId === c.id);
        const on = mine.length > 0;
        return (
          <div
            key={c.id}
            className={`relative overflow-hidden rounded-2xl border p-2 text-center transition-colors ${
              on ? 'border-2 border-aurora bg-aurora/10' : 'border-line bg-white/[0.02] opacity-60'
            }`}
          >
            <svg viewBox="0 0 100 50" className={`w-full ${compact ? 'h-8' : 'h-14'} ${on ? 'text-aurora' : 'text-white/25'}`} fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="94" height="44" rx="2" />
              <line x1="50" y1="3" x2="50" y2="47" strokeDasharray="2 2" />
              <line x1="36" y1="3" x2="36" y2="47" />
              <line x1="64" y1="3" x2="64" y2="47" />
              <line x1="3" y1="25" x2="36" y2="25" />
              <line x1="64" y1="25" x2="97" y2="25" />
            </svg>
            <p className={`mt-1 font-display text-xs font-semibold ${on ? 'text-white' : 'text-white/50'}`}>{c.name}</p>
            {on && (
              <div className="mt-1 space-y-1">
                {mine.map((r) => (
                  <p key={r.start} className="flex items-center justify-center gap-1 rounded-full bg-aurora px-2 py-0.5 text-[11px] font-semibold text-ink">
                    <Icon d={icons.pin} className="size-3" />
                    {formatRange(r.start, r.end)}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
