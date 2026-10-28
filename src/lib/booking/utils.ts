import type {
  Block,
  Booking,
  DateKey,
  DiscountCode,
  Occupancy,
  Settings,
  Slot,
  SlotState,
} from './types';

// ---------- Dates and time at the venue ----------

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

export function daysBetween(from: DateKey, to: DateKey): number {
  return Math.round((fromKey(to).getTime() - fromKey(from).getTime()) / 86_400_000);
}

/** Wall-clock date and time at the venue, whatever timezone the viewer is in. */
export function venueNow(tz: string, at = new Date()): { date: DateKey; hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
  } catch {
    return { date: toKey(at), hour: at.getHours(), minute: at.getMinutes() };
  }
}

export const venueToday = (s: Settings) => venueNow(s.timezone).date;

/** Hours from now until a slot starts (negative once it has started). */
export function hoursUntil(s: Settings, date: DateKey, hour: number, at = new Date()): number {
  const now = venueNow(s.timezone, at);
  return daysBetween(now.date, date) * 24 + hour - (now.hour + now.minute / 60);
}

export const isPast = (s: Settings, date: DateKey, hour: number, at?: Date) => hoursUntil(s, date, hour, at) <= 0;

export const startHour = (slots: Slot[]) => Math.min(...slots.map((x) => x.hour));
export const endHour = (slots: Slot[]) => Math.max(...slots.map((x) => x.hour)) + 1;

// ---------- Opening hours and pricing ----------

/** Opening hours for a date, or null when the venue is closed. */
export function dayHours(s: Settings, date: DateKey): { open: number; close: number } | null {
  if (s.holidays.some((h) => h.date === date)) return null;
  const d = s.hours[fromKey(date).getDay()];
  if (!d || d.closed || d.close <= d.open) return null;
  return { open: d.open, close: d.close };
}

export function hoursList(s: Settings, date: DateKey): number[] {
  const h = dayHours(s, date);
  if (!h) return [];
  return Array.from({ length: h.close - h.open }, (_, i) => h.open + i);
}

export function isPeak(s: Settings, date: DateKey, hour: number): boolean {
  const p = s.peak;
  return p.enabled && p.days.includes(fromKey(date).getDay()) && hour >= p.startHour && hour < p.endHour;
}

export function slotPrice(s: Settings, courtId: string, date: DateKey, hour: number): number {
  if (isPeak(s, date, hour)) return s.peak.pricePerHour;
  return s.courts.find((c) => c.id === courtId)?.pricePerHour ?? 0;
}

export function quote(
  s: Settings,
  date: DateKey,
  slots: Slot[],
  discount?: Pick<DiscountCode, 'kind' | 'value'> | null,
) {
  const subtotal = slots.reduce((sum, x) => sum + slotPrice(s, x.courtId, date, x.hour), 0);
  let discountAmount = 0;
  if (discount) {
    discountAmount =
      discount.kind === 'percent'
        ? Math.round(subtotal * discount.value) / 100
        : Math.min(discount.value, subtotal);
  }
  return { subtotal, discountAmount, total: Math.max(0, subtotal - discountAmount) };
}

/** Throws a readable error if these slots can't be booked. */
export function validateSlots(s: Settings, date: DateKey, slots: Slot[], allowPast = false) {
  if (!slots.length) throw new Error('Pick at least one hour.');
  const hours = dayHours(s, date);
  if (!hours) throw new Error('The venue is closed that day.');
  if (!allowPast && daysBetween(venueToday(s), date) > s.maxDaysAhead) {
    throw new Error('That date is too far ahead.');
  }
  const seen = new Set<string>();
  for (const x of slots) {
    const court = s.courts.find((c) => c.id === x.courtId);
    if (!court || !court.active) throw new Error('That court is not available.');
    if (x.hour < hours.open || x.hour >= hours.close) throw new Error('That time is outside opening hours.');
    if (!allowPast && isPast(s, date, x.hour)) throw new Error('That time has already passed.');
    const k = slotKey(x.courtId, x.hour);
    if (seen.has(k)) throw new Error('Duplicate hour selected.');
    seen.add(k);
  }
}

export function canRequestCancel(s: Settings, b: { status: string; date: DateKey; slots: Slot[]; cancelRequest?: { status: string } }) {
  if (!s.cancellation.allowRequests) return { ok: false, reason: 'Online cancellation requests are turned off. Please contact the venue.' };
  if (b.status !== 'confirmed') return { ok: false, reason: 'Only confirmed bookings can be cancelled.' };
  if (b.cancelRequest?.status === 'pending') return { ok: false, reason: 'A cancellation request is already waiting for the venue to confirm.' };
  if (hoursUntil(s, b.date, startHour(b.slots)) < s.cancellation.minHoursBefore) {
    return { ok: false, reason: `Cancellations must be requested at least ${s.cancellation.minHoursBefore} hours before your booking. Please contact the venue.` };
  }
  return { ok: true, reason: '' };
}

// ---------- Grid ----------

export const slotKey = (courtId: string, hour: number) => `${courtId}@${hour}`;

export function parseSlotKey(k: string): Slot {
  const [courtId, hour] = k.split('@');
  return { courtId, hour: Number(hour) };
}

export function isActiveBooking(b: Booking, now = Date.now()): boolean {
  return b.status === 'confirmed' || (b.status === 'held' && (b.holdExpiresAt ?? 0) > now);
}

/**
 * Works out what is in each court/hour cell for one day. Pass `bookings`
 * (admin, full details) or `occupancy` (public, no personal details).
 */
export function buildSlotStates(opts: {
  settings: Settings;
  date: DateKey;
  blocks: Block[];
  bookings?: Booking[];
  occupancy?: Occupancy[];
  mine?: Set<string>;
  hours?: number[];
}): Map<string, SlotState> {
  const { settings: s, date, blocks } = opts;
  const map = new Map<string, SlotState>();
  const now = Date.now();
  const hours = opts.hours ?? hoursList(s, date);

  for (const court of s.courts) {
    for (const h of hours) {
      const state: SlotState = !court.active ? { kind: 'closed' } : isPast(s, date, h) ? { kind: 'past' } : { kind: 'open' };
      map.set(slotKey(court.id, h), state);
    }
  }

  for (const bl of blocks) {
    if (bl.date !== date) continue;
    for (const court of s.courts) {
      if (bl.courtId !== 'all' && bl.courtId !== court.id) continue;
      for (let h = bl.startHour; h < bl.endHour; h++) map.set(slotKey(court.id, h), { kind: 'blocked', block: bl });
    }
  }

  for (const b of opts.bookings ?? []) {
    if (b.date !== date || !isActiveBooking(b, now)) continue;
    for (const x of b.slots) {
      map.set(slotKey(x.courtId, x.hour), { kind: b.status === 'held' ? 'held' : 'booked', bookingId: b.id, booking: b });
    }
  }

  for (const o of opts.occupancy ?? []) {
    if (o.date !== date) continue;
    if (o.kind === 'held' && (o.holdExpiresAt ?? 0) <= now) continue;
    const kind = opts.mine?.has(o.bookingId) ? 'mine' : o.kind;
    map.set(slotKey(o.courtId, o.hour), { kind, bookingId: o.bookingId });
  }

  return map;
}

// ---------- Formatting ----------

export function formatHour(h: number): string {
  const suffix = h < 12 || h === 24 ? 'AM' : 'PM';
  return `${((h + 11) % 12) + 1}${suffix}`;
}

export const formatRange = (start: number, end: number) => `${formatHour(start)} – ${formatHour(end)}`;

export function formatDate(key: DateKey, opts: Intl.DateTimeFormatOptions = {}): string {
  return fromKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...opts });
}

export function formatMoney(n: number, symbol: string): string {
  return `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const courtName = (s: Settings, id: string) =>
  id === 'all' ? 'All courts' : (s.courts.find((c) => c.id === id)?.name ?? id);

/** Groups slots into readable lines like "Court 1 · 6PM – 8PM". */
export function describeSlots(s: Settings, slots: Slot[]): string[] {
  const lines: string[] = [];
  const courtIds = [...new Set([...s.courts.map((c) => c.id), ...slots.map((x) => x.courtId)])];
  for (const id of courtIds) {
    const hs = slots.filter((x) => x.courtId === id).map((x) => x.hour).sort((a, b) => a - b);
    let i = 0;
    while (i < hs.length) {
      let j = i;
      while (j + 1 < hs.length && hs[j + 1] === hs[j] + 1) j++;
      lines.push(`${courtName(s, id)} · ${formatRange(hs[i], hs[j] + 1)}`);
      i = j + 1;
    }
  }
  return lines;
}

/** Splits slots into runs of consecutive hours on the same court. */
export function slotRuns(slots: Slot[]): { courtId: string; start: number; end: number }[] {
  const runs: { courtId: string; start: number; end: number }[] = [];
  const sorted = [...slots].sort((a, b) => a.courtId.localeCompare(b.courtId) || a.hour - b.hour);
  for (const x of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.courtId === x.courtId && last.end === x.hour) last.end++;
    else runs.push({ courtId: x.courtId, start: x.hour, end: x.hour + 1 });
  }
  return runs;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function makeReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = '';
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return `PI-${r}`;
}

/** Key used to group bookings by customer: digits of the phone, else email. */
export function customerKey(g: { phone: string; email: string }): string {
  const digits = g.phone.replace(/\D/g, '');
  return digits.length >= 7 ? digits : g.email.trim().toLowerCase();
}

export function matchesContact(g: { phone: string; email: string }, contact: string): boolean {
  const c = contact.trim().toLowerCase();
  if (!c) return false;
  if (c.includes('@')) return g.email.trim().toLowerCase() === c;
  const digits = c.replace(/\D/g, '');
  return digits.length >= 7 && g.phone.replace(/\D/g, '') === digits;
}

/** Fills {name}, {reference}, {court}, {date}, {time}, {amount} in an email template. */
export function fillTemplate(s: Settings, template: string, b: Pick<Booking, 'guest' | 'reference' | 'date' | 'slots' | 'amount'>) {
  return template
    .replaceAll('{name}', b.guest.name.split(' ')[0] || b.guest.name)
    .replaceAll('{reference}', b.reference)
    .replaceAll('{court}', describeSlots(s, b.slots).map((l) => l.split(' · ')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', '))
    .replaceAll('{date}', formatDate(b.date, { weekday: 'long', month: 'long' }))
    .replaceAll('{time}', slotRuns(b.slots).map((r) => formatRange(r.start, r.end)).join(', '))
    .replaceAll('{amount}', formatMoney(b.amount, s.currencySymbol));
}
