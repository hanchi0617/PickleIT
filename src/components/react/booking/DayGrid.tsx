import { booking } from '../../../config/site';
import type { SlotState } from '../../../lib/booking/types';
import { formatHour, hours, slotKey } from '../../../lib/booking/utils';

interface Props {
  states: Map<string, SlotState>;
  selected?: Set<string>;
  highlightCourt?: string | null;
  /** Admin mode shows guest names and lets every cell be clicked. */
  admin?: boolean;
  onCellClick: (courtId: string, hour: number, state: SlotState) => void;
}

// Court-by-hour grid. Courts are columns so it fits a phone screen without
// sideways scrolling.
export default function DayGrid({ states, selected, highlightCourt, admin, onCellClick }: Props) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[300px] gap-1.5"
        style={{ gridTemplateColumns: `3.5rem repeat(${booking.courts.length}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Court availability"
      >
        <div />
        {booking.courts.map((c) => (
          <div
            key={c.id}
            role="columnheader"
            className={`rounded-xl px-2 py-2 text-center font-display text-sm font-semibold ${
              highlightCourt === c.id ? 'bg-aurora/15 text-aurora' : 'text-white'
            }`}
          >
            {c.name}
          </div>
        ))}

        {hours.map((h) => (
          <Row key={h} hour={h}>
            {booking.courts.map((c) => {
              const key = slotKey(c.id, h);
              const state = states.get(key) ?? { kind: 'open' as const };
              return (
                <Cell
                  key={key}
                  state={state}
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

function Cell({
  state,
  selected,
  admin,
  label,
  onClick,
}: {
  state: SlotState;
  selected: boolean;
  admin?: boolean;
  label: string;
  onClick: () => void;
}) {
  const base =
    'h-11 rounded-xl border text-xs font-medium transition-all duration-200 truncate px-2 outline-none focus-visible:ring-2 focus-visible:ring-aurora/70';

  if (selected) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed="true"
        aria-label={`${label}, selected`}
        className={`${base} border-aurora bg-aurora text-ink shadow-[0_0_20px_rgb(124_255_103/0.35)]`}
      >
        Selected
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
          className={`${base} border-line bg-white/[0.04] text-mist hover:-translate-y-0.5 hover:border-aurora/60 hover:bg-aurora/10 hover:text-aurora`}
        >
          {admin ? '' : 'Open'}
        </button>
      );
    case 'past':
      return (
        <div aria-label={`${label}, past`} className={`${base} grid place-items-center border-transparent bg-white/[0.015] text-white/20`}>
          —
        </div>
      );
    case 'blocked': {
      const Tag = admin ? 'button' : 'div';
      return (
        <Tag
          {...(admin ? { type: 'button' as const, onClick } : {})}
          aria-label={`${label}, closed: ${state.block.reason}`}
          title={state.block.reason}
          className={`${base} grid place-items-center border-amber-400/20 text-amber-200/70 [background:repeating-linear-gradient(135deg,rgb(251_191_36/0.08)_0_6px,transparent_6px_12px)]`}
        >
          {admin ? state.block.reason : 'Closed'}
        </Tag>
      );
    }
    case 'held':
    case 'booked': {
      const held = state.kind === 'held';
      const Tag = admin ? 'button' : 'div';
      const unpaid = state.booking.paymentStatus === 'unpaid';
      return (
        <Tag
          {...(admin ? { type: 'button' as const, onClick } : {})}
          aria-label={`${label}, ${held ? 'on hold' : 'booked'}`}
          className={`${base} grid place-items-center ${
            held
              ? 'border-sky-400/30 bg-sky-400/10 text-sky-200'
              : admin
                ? `border-aurora/25 bg-aurora/[0.08] text-white hover:border-aurora/60 ${unpaid ? 'ring-1 ring-inset ring-rose-400/40' : ''}`
                : 'border-transparent bg-white/[0.06] text-white/35'
          }`}
        >
          {admin ? state.booking.guest.name : held ? 'On hold' : 'Booked'}
        </Tag>
      );
    }
  }
}

export function Legend({ admin }: { admin?: boolean }) {
  const items = admin
    ? [
        { cls: 'border-line bg-white/[0.04]', label: 'Open' },
        { cls: 'border-aurora/25 bg-aurora/10', label: 'Booked' },
        { cls: 'border-rose-400/60 bg-aurora/10', label: 'Unpaid' },
        { cls: 'border-sky-400/30 bg-sky-400/10', label: 'On hold' },
        { cls: 'border-amber-400/20 bg-amber-400/10', label: 'Closed' },
      ]
    : [
        { cls: 'border-line bg-white/[0.04]', label: 'Open' },
        { cls: 'border-aurora bg-aurora', label: 'Selected' },
        { cls: 'border-transparent bg-white/[0.08]', label: 'Booked' },
        { cls: 'border-sky-400/30 bg-sky-400/10', label: 'On hold' },
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
    </ul>
  );
}
