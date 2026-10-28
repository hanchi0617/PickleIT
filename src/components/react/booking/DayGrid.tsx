import type { CourtSetting, SlotState } from '../../../lib/booking/types';
import { formatHour, slotKey } from '../../../lib/booking/utils';
import { Icon, icons } from '../ui';

interface Props {
  courts: CourtSetting[];
  hours: number[];
  states: Map<string, SlotState>;
  selected?: Set<string>;
  highlightCourt?: string | null;
  /** Admin mode shows guest names and attendance, and every cell is clickable. */
  admin?: boolean;
  onCellClick: (courtId: string, hour: number, state: SlotState) => void;
}

// Court-by-hour grid. Courts are columns so it fits a phone without sideways
// scrolling.
export default function DayGrid({ courts, hours, states, selected, highlightCourt, admin, onCellClick }: Props) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `3.25rem repeat(${courts.length}, minmax(4.5rem, 1fr))` }}
        role="grid"
        aria-label="Court availability"
      >
        <div />
        {courts.map((c) => (
          <div
            key={c.id}
            role="columnheader"
            className={`rounded-xl px-2 py-2 text-center font-display text-sm font-semibold ${
              highlightCourt === c.id ? 'bg-aurora/15 text-aurora' : c.active ? 'text-white' : 'text-white/35'
            }`}
          >
            {c.name}
            {!c.active && <span className="block text-[10px] font-normal">inactive</span>}
          </div>
        ))}

        {hours.map((h) => (
          <Row key={h} hour={h}>
            {courts.map((c) => {
              const key = slotKey(c.id, h);
              const state = states.get(key) ?? ({ kind: 'closed' } as const);
              return (
                <Cell
                  key={key}
                  state={state}
                  hour={h}
                  selected={selected?.has(key) ?? false}
                  admin={admin}
                  label={`${c.name}, ${formatHour(h)}`}
                  onClick={() => onCellClick(c.id, h, state)}
                />
              );
            })}
          </Row>
        ))}
      </div>
    </div>
  );
}

function Row({ hour, children }: { hour: number; children: React.ReactNode }) {
  return (
    <>
      <div role="rowheader" className="flex items-center justify-end pr-2 text-xs tabular-nums text-mist">
        {formatHour(hour)}
      </div>
      {children}
    </>
  );
}

const base =
  'relative h-12 min-w-0 rounded-xl border px-2 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-aurora/70';

function Cell({
  state,
  hour,
  selected,
  admin,
  label,
  onClick,
}: {
  state: SlotState;
  hour: number;
  selected: boolean;
  admin?: boolean;
  label: string;
  onClick: () => void;
}) {
  if (selected) {
    return (
      <button type="button" onClick={onClick} aria-pressed="true" aria-label={`${label}, selected`} className={`${base} border-aurora bg-aurora text-ink`}>
        <span className="flex items-center justify-center gap-1">
          <Icon d={icons.check} className="size-3.5" /> {formatHour(hour)}
        </span>
      </button>
    );
  }

  switch (state.kind) {
    case 'open':
      return (
        <button
          type="button"
          onClick={onClick}
          aria-pressed="false"
          aria-label={`${label}, available`}
          className={`${base} border-line bg-white/[0.04] text-mist hover:border-aurora/60 hover:bg-aurora/10 hover:text-aurora`}
        >
          {admin ? '' : 'Open'}
        </button>
      );
    case 'past':
    case 'closed':
      return (
        <div aria-label={`${label}, ${state.kind === 'past' ? 'past' : 'not available'}`} className={`${base} grid place-items-center border-transparent bg-white/[0.015] text-white/20`}>
          —
        </div>
      );
    case 'blocked':
      return (
        <button
          type="button"
          onClick={onClick}
          disabled={!admin}
          aria-label={`${label}, closed: ${state.block.reason}`}
          title={state.block.reason}
          className={`${base} truncate border-amber-400/20 text-amber-200/70 [background:repeating-linear-gradient(135deg,rgb(251_191_36/0.08)_0_6px,transparent_6px_12px)] disabled:cursor-default`}
        >
          {admin ? state.block.reason : 'Closed'}
        </button>
      );
    case 'mine':
      // The renter's own booking: a clear marker so they can't mix up their time.
      return (
        <button
          type="button"
          onClick={onClick}
          aria-label={`${label}, your booking`}
          className={`${base} border-2 border-aurora bg-aurora/15 text-aurora`}
        >
          <span className="flex items-center justify-center gap-1">
            <Icon d={icons.pin} className="size-3.5 shrink-0" />
            <span className="truncate">Yours</span>
          </span>
        </button>
      );
    case 'held':
    case 'booked': {
      const b = state.booking;
      if (!admin || !b) {
        const held = state.kind === 'held';
        return (
          <button
            type="button"
            onClick={onClick}
            aria-label={`${label}, ${held ? 'on hold' : 'booked'}`}
            className={`${base} grid place-items-center ${
              held ? 'border-sky-400/30 bg-sky-400/10 text-sky-200' : 'border-transparent bg-white/[0.06] text-white/35 hover:text-white/60'
            }`}
          >
            {held ? 'On hold' : 'Booked'}
          </button>
        );
      }
      const tone =
        state.kind === 'held'
          ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
          : b.attendance === 'checked-in'
            ? 'border-aurora/70 bg-aurora/25 text-white'
            : b.attendance === 'no-show'
              ? 'border-rose-400/50 bg-rose-500/15 text-rose-100'
              : 'border-aurora/25 bg-aurora/[0.08] text-white';
      return (
        <button
          type="button"
          onClick={onClick}
          aria-label={`${label}, ${b.guest.name}, ${b.attendance}`}
          className={`${base} text-left hover:border-white/40 ${tone} ${b.paymentStatus === 'unpaid' ? 'ring-1 ring-inset ring-rose-400/50' : ''}`}
        >
          <span className="flex items-center gap-1">
            {b.attendance === 'checked-in' && <Icon d={icons.check} className="size-3 shrink-0 text-aurora" />}
            {b.attendance === 'no-show' && <Icon d={icons.x} className="size-3 shrink-0 text-rose-300" />}
            <span className="truncate">{b.guest.name}</span>
          </span>
          {b.cancelRequest?.status === 'pending' && (
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-300" title="Cancellation requested" />
          )}
        </button>
      );
    }
  }
}

export function Legend({ admin }: { admin?: boolean }) {
  const items = admin
    ? [
        { cls: 'border-line bg-white/[0.04]', label: 'Open' },
        { cls: 'border-aurora/25 bg-aurora/10', label: 'Booked' },
        { cls: 'border-aurora/70 bg-aurora/30', label: 'Checked in' },
        { cls: 'border-rose-400/50 bg-rose-500/20', label: 'No-show' },
        { cls: 'border-rose-400/60 bg-transparent', label: 'Unpaid' },
        { cls: 'border-sky-400/30 bg-sky-400/10', label: 'On hold' },
        { cls: 'border-amber-400/20 bg-amber-400/10', label: 'Closed' },
      ]
    : [
        { cls: 'border-line bg-white/[0.04]', label: 'Open' },
        { cls: 'border-aurora bg-aurora', label: 'Selected' },
        { cls: 'border-2 border-aurora bg-aurora/15', label: 'Your booking' },
        { cls: 'border-transparent bg-white/[0.08]', label: 'Booked' },
        { cls: 'border-amber-400/20 bg-amber-400/10', label: 'Closed' },
      ];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-mist">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={`size-3 rounded border ${i.cls}`} />
          {i.label}
        </li>
      ))}
      {admin && (
        <li className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-amber-300" /> Cancel requested
        </li>
      )}
    </ul>
  );
}
