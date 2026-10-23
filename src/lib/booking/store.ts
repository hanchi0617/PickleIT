// Demo booking store.
//
// Everything lives in this browser's localStorage so the full booking and
// admin flow can be tried before a backend exists. Tabs in the same browser
// see each other's changes live (BroadcastChannel + storage events), which
// stands in for real-time updates.
//
// The API is async on purpose: swapping this file for a Supabase-backed
// version later should not change any of the UI code. In that version the
// double-booking check must be enforced by the database, not here.

import { booking as cfg } from '../../config/site';
import {
  SlotTakenError,
  type Block,
  type Booking,
  type BookingSource,
  type DateKey,
  type Guest,
  type Slot,
} from './types';
import { addDays, hours, isActive, isPast, makeReference, priceFor, todayKey, uid } from './utils';

const KEY = 'quad.booking-db.v1';
const CHANNEL = 'quad.booking-db';

interface DB {
  bookings: Booking[];
  blocks: Block[];
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
const listeners = new Set<() => void>();

function read(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  const db = seed();
  write(db, false);
  return db;
}

function write(db: DB, notify = true) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* storage full or blocked: the change only lasts this page view */
  }
  if (notify) {
    channel?.postMessage('changed');
    emit();
  }
}

function emit() {
  listeners.forEach((fn) => fn());
}

if (typeof window !== 'undefined') {
  channel?.addEventListener('message', emit);
  window.addEventListener('storage', (e) => e.key === KEY && emit());
  // Re-render periodically so expired holds free up and past hours grey out.
  window.setInterval(emit, 15_000);
}

/** Calls `fn` whenever bookings change (in this tab or another). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function expireHolds(db: DB, now = Date.now()) {
  for (const b of db.bookings) {
    if (b.status === 'held' && (b.holdExpiresAt ?? 0) <= now) {
      b.status = 'expired';
      b.paymentStatus = 'unpaid';
      delete b.holdExpiresAt;
    }
  }
}

function conflicts(db: DB, date: DateKey, slots: Slot[], ignoreId?: string): Slot[] {
  const now = Date.now();
  return slots.filter((s) => {
    const booked = db.bookings.some(
      (b) =>
        b.id !== ignoreId &&
        b.date === date &&
        isActive(b, now) &&
        b.slots.some((x) => x.courtId === s.courtId && x.hour === s.hour),
    );
    const blocked = db.blocks.some(
      (bl) =>
        bl.date === date &&
        (bl.courtId === 'all' || bl.courtId === s.courtId) &&
        s.hour >= bl.startHour &&
        s.hour < bl.endHour,
    );
    return booked || blocked;
  });
}

function validateSlots(date: DateKey, slots: Slot[], allowPast = false) {
  if (!slots.length) throw new Error('Pick at least one hour.');
  for (const s of slots) {
    if (!hours.includes(s.hour)) throw new Error('That time is outside opening hours.');
    if (!cfg.courts.some((c) => c.id === s.courtId)) throw new Error('Unknown court.');
    if (!allowPast && isPast(date, s.hour)) throw new Error('That time has already passed.');
  }
}

// ---------- Reads ----------

export async function getDay(date: DateKey): Promise<{ bookings: Booking[]; blocks: Block[] }> {
  const db = read();
  return {
    bookings: db.bookings.filter((b) => b.date === date),
    blocks: db.blocks.filter((b) => b.date === date),
  };
}

export async function getRange(from: DateKey, to: DateKey): Promise<DB> {
  const db = read();
  const inRange = (d: DateKey) => d >= from && d <= to;
  return {
    bookings: db.bookings.filter((b) => inRange(b.date)),
    blocks: db.blocks.filter((b) => inRange(b.date)),
  };
}

export async function getAll(): Promise<DB> {
  return read();
}

export async function findByReference(reference: string): Promise<Booking | undefined> {
  const ref = reference.trim().toUpperCase();
  return read().bookings.find((b) => b.reference === ref);
}

// ---------- Guest flow ----------

/** Reserves the slots for `holdMinutes` while the guest pays. */
export async function createHold(date: DateKey, slots: Slot[], guest: Guest): Promise<Booking> {
  validateSlots(date, slots);
  const db = read();
  expireHolds(db);
  const taken = conflicts(db, date, slots);
  if (taken.length) throw new SlotTakenError(taken);

  const now = Date.now();
  const b: Booking = {
    id: uid(),
    reference: makeReference(),
    date,
    slots,
    guest,
    status: 'held',
    paymentStatus: 'pending',
    source: 'online',
    amount: priceFor(slots),
    createdAt: now,
    holdExpiresAt: now + cfg.holdMinutes * 60_000,
  };
  db.bookings.push(b);
  write(db);
  return b;
}

/**
 * Marks a held booking as paid. With a real payment provider this is called
 * by the server when the provider's webhook reports success, never directly
 * from the browser.
 */
export async function confirmPayment(id: string): Promise<Booking> {
  const db = read();
  expireHolds(db);
  const b = db.bookings.find((x) => x.id === id);
  if (!b) throw new Error('Booking not found.');
  if (b.status !== 'held') {
    write(db);
    throw new Error('Your hold expired before payment finished. Please pick your slot again.');
  }
  b.status = 'confirmed';
  b.paymentStatus = 'paid';
  delete b.holdExpiresAt;
  write(db);
  return b;
}

export async function releaseHold(id: string): Promise<void> {
  const db = read();
  const b = db.bookings.find((x) => x.id === id);
  if (b?.status === 'held') {
    b.status = 'expired';
    b.paymentStatus = 'unpaid';
    delete b.holdExpiresAt;
    write(db);
  }
}

// ---------- Admin ----------

export async function createManualBooking(
  date: DateKey,
  slots: Slot[],
  guest: Guest,
  source: Exclude<BookingSource, 'online'>,
  paid: boolean,
  notes?: string,
): Promise<Booking> {
  validateSlots(date, slots, true);
  const db = read();
  expireHolds(db);
  const taken = conflicts(db, date, slots);
  if (taken.length) throw new SlotTakenError(taken);

  const b: Booking = {
    id: uid(),
    reference: makeReference(),
    date,
    slots,
    guest,
    status: 'confirmed',
    paymentStatus: paid ? 'paid' : 'unpaid',
    source,
    amount: priceFor(slots),
    createdAt: Date.now(),
    notes,
  };
  db.bookings.push(b);
  write(db);
  return b;
}

export async function cancelBooking(id: string, refund: boolean): Promise<void> {
  const db = read();
  const b = db.bookings.find((x) => x.id === id);
  if (!b) throw new Error('Booking not found.');
  b.status = 'cancelled';
  if (b.paymentStatus === 'paid' && refund) b.paymentStatus = 'refunded';
  if (b.paymentStatus === 'pending') b.paymentStatus = 'unpaid';
  delete b.holdExpiresAt;
  write(db);
}

export async function markPaid(id: string): Promise<void> {
  const db = read();
  const b = db.bookings.find((x) => x.id === id);
  if (!b) throw new Error('Booking not found.');
  b.paymentStatus = 'paid';
  write(db);
}

export async function addBlock(block: Omit<Block, 'id'>): Promise<Block> {
  if (block.endHour <= block.startHour) throw new Error('End time must be after start time.');
  const db = read();
  const b = { ...block, id: uid() };
  db.blocks.push(b);
  write(db);
  return b;
}

export async function removeBlock(id: string): Promise<void> {
  const db = read();
  db.blocks = db.blocks.filter((b) => b.id !== id);
  write(db);
}

export async function resetDemoData(): Promise<void> {
  write(seed());
}

// ---------- Demo seed ----------

function seed(): DB {
  const names = [
    ['Alex Rivera', '0917 555 0101'],
    ['Sam Cruz', '0917 555 0102'],
    ['Jordan Lee', '0917 555 0103'],
    ['Taylor Santos', '0917 555 0104'],
    ['Casey Tan', '0917 555 0105'],
    ['Morgan Reyes', '0917 555 0106'],
    ['Riley Garcia', '0917 555 0107'],
    ['Jamie Ong', '0917 555 0108'],
  ];

  // Small deterministic PRNG so the demo looks the same on every reset.
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  const bookings: Booking[] = [];
  const today = todayKey();

  for (let d = 0; d < 10; d++) {
    const date = addDays(today, d);
    for (const court of cfg.courts) {
      let h = cfg.openHour;
      while (h < cfg.closeHour) {
        const busy = h >= 17 ? 0.55 : h <= 8 ? 0.35 : 0.18;
        if (rand() < busy) {
          const len = Math.min(rand() < 0.4 ? 2 : 1, cfg.closeHour - h);
          const [name, phone] = names[Math.floor(rand() * names.length)];
          const slots = Array.from({ length: len }, (_, i) => ({ courtId: court.id, hour: h + i }));
          const source: BookingSource = rand() < 0.75 ? 'online' : rand() < 0.5 ? 'walk-in' : 'phone';
          bookings.push({
            id: uid(),
            reference: makeReference(),
            date,
            slots,
            guest: { name, phone, email: `${name.split(' ')[0].toLowerCase()}@example.com` },
            status: 'confirmed',
            paymentStatus: source === 'online' || rand() < 0.6 ? 'paid' : 'unpaid',
            source,
            amount: priceFor(slots),
            createdAt: Date.now() - Math.floor(rand() * 5 * 86_400_000),
            demo: true,
          });
          h += len;
        } else {
          h += 1;
        }
      }
    }
  }

  const blocks: Block[] = [
    {
      id: uid(),
      date: addDays(today, 2),
      courtId: cfg.courts[2].id,
      startHour: cfg.openHour,
      endHour: cfg.openHour + 2,
      reason: 'Court maintenance',
    },
  ];

  const db = { bookings: [] as Booking[], blocks };
  db.bookings = bookings.filter((b) => !conflicts(db, b.date, b.slots).length);
  return db;
}
