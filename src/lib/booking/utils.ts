import { booking } from '../../config/site';
import type { Block, Booking, DateKey, Slot, SlotState } from './types';

export const hours: number[] = Array.from(
  { length: booking.closeHour - booking.openHour },
  (_, i) => booking.openHour + i,
);

export function toKey(d: Date): DateKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export const todayKey = () => toKey(new Date());

export function formatHour(h: number): string {
  const suffix = h < 12 || h === 24 ? 'AM' : 'PM';
  return `${((h + 11) % 12) + 1}${suffix}`;
}

export function formatRange(start: number, end: number): string {
  return `${formatHour(start)} – ${formatHour(end)}`;
}

export function formatDate(key: DateKey, opts: Intl.DateTimeFormatOptions = {}): string {
  return fromKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...opts,
  });
}

export function formatMoney(n: number): string {
  return `${booking.currencySymbol}${n.toLocaleString()}`;
}

export function courtName(id: string): string {
  return booking.courts.find((c) => c.id === id)?.name ?? id;
}

export const priceFor = (slots: Slot[]) => slots.length * booking.pricePerHour;

export function isPast(date: DateKey, hour: number, now = new Date()): boolean {
  // A slot can no longer be booked once it has started.
  const t = fromKey(date);
  t.setHours(hour, 0, 0, 0);
  return t.getTime() <= now.getTime();
}

export function isActive(b: Booking, now = Date.now()): boolean {
  return b.status === 'confirmed' || (b.status === 'held' && (b.holdExpiresAt ?? 0) > now);
}

/** Works out what is in each court/hour cell for one day. */
export function slotStates(
  date: DateKey,
  bookings: Booking[],
  blocks: Block[],
  now = new Date(),
): Map<string, SlotState> {
  const map = new Map<string, SlotState>();
  const t = now.getTime();

  for (const court of booking.courts) {
    for (const h of hours) {
      map.set(slotKey(court.id, h), isPast(date, h, now) ? { kind: 'past' } : { kind: 'open' });
    }
  }

  for (const bl of blocks) {
    if (bl.date !== date) continue;
    for (const court of booking.courts) {
      if (bl.courtId !== 'all' && bl.courtId !== court.id) continue;
      for (let h = bl.startHour; h < bl.endHour; h++) {
        map.set(slotKey(court.id, h), { kind: 'blocked', block: bl });
      }
    }
  }

  for (const b of bookings) {
    if (b.date !== date || !isActive(b, t)) continue;
    for (const s of b.slots) {
      map.set(slotKey(s.courtId, s.hour), {
        kind: b.status === 'held' ? 'held' : 'booked',
        booking: b,
      });
    }
  }

  return map;
}

export const slotKey = (courtId: string, hour: number) => `${courtId}@${hour}`;

/** Groups slots into readable lines like "Court 1 · 6PM – 8PM". */
export function describeSlots(slots: Slot[]): string[] {
  const lines: string[] = [];
  for (const court of booking.courts) {
    const hs = slots
      .filter((s) => s.courtId === court.id)
      .map((s) => s.hour)
      .sort((a, b) => a - b);
    let i = 0;
    while (i < hs.length) {
      let j = i;
      while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
      lines.push(`${court.name} · ${formatRange(hs[i], hs[j] + 1)}`);
      i = j + 1;
    }
  }
  return lines;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function makeReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `QD-${s}`;
}
