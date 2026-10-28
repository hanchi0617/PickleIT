// Demo backend: everything lives in this browser's localStorage so the full
// booking and admin flow can be tried before a database is connected. Tabs in
// the same browser see each other's changes live, standing in for real-time.
//
// It follows the same rules as the Supabase functions in
// supabase/migrations, but nothing here is secure: anyone can edit their own
// browser storage. Only the Supabase backend is safe to launch with.

import { defaultSettings } from '../../config/site';
import type { Backend } from './api';
import {
  SlotTakenError,
  type AuditEntry,
  type Block,
  type Booking,
  type CustomerNote,
  type DateKey,
  type DiscountCode,
  type GuestBooking,
  type Occupancy,
  type Role,
  type Settings,
  type Slot,
  type StaffSession,
  type WaitlistEntry,
} from './types';
import {
  addDays,
  canRequestCancel,
  describeSlots,
  hoursList,
  isActiveBooking,
  makeReference,
  matchesContact,
  quote,
  uid,
  validateSlots,
  venueNow,
  venueToday,
} from './utils';

const KEY = 'pickleit.demo-db.v2';
const SESSION_KEY = 'pickleit.demo-session';
const CHANNEL = 'pickleit.demo-db';

interface DB {
  settings: Settings;
  bookings: Booking[];
  blocks: Block[];
  waitlist: WaitlistEntry[];
  discounts: DiscountCode[];
  notes: CustomerNote[];
  audit: AuditEntry[];
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  channel?.addEventListener('message', emit);
  window.addEventListener('storage', (e) => e.key === KEY && emit());
  // Re-render periodically so expired holds free up and past hours grey out.
  window.setInterval(emit, 15_000);
}

function read(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const db = JSON.parse(raw) as DB;
      db.settings = { ...defaultSettings, ...db.settings };
      return db;
    }
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

/** Reads, applies `fn`, expires stale holds and saves, like one DB transaction. */
function tx<T>(fn: (db: DB) => T): T {
  const db = read();
  expireHolds(db);
  const out = fn(db);
  write(db);
  return out;
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

function assertFree(db: DB, date: DateKey, slots: Slot[], ignoreId?: string) {
  const now = Date.now();
  const taken = slots.filter(
    (x) =>
      db.bookings.some(
        (b) =>
          b.id !== ignoreId &&
          b.date === date &&
          isActiveBooking(b, now) &&
          b.slots.some((y) => y.courtId === x.courtId && y.hour === x.hour),
      ) ||
      db.blocks.some(
        (bl) =>
          bl.date === date &&
          (bl.courtId === 'all' || bl.courtId === x.courtId) &&
          x.hour >= bl.startHour &&
          x.hour < bl.endHour,
      ),
  );
  if (taken.length) throw new SlotTakenError(taken);
}

function getBooking(db: DB, id: string): Booking {
  const b = db.bookings.find((x) => x.id === id);
  if (!b) throw new Error('Booking not found.');
  return b;
}

function session(): StaffSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

function requireStaff(): StaffSession {
  const s = session();
  if (!s) throw new Error('Please sign in.');
  return s;
}

function requireOwner(): StaffSession {
  const s = requireStaff();
  if (s.role !== 'owner') throw new Error('Only the owner can do that.');
  return s;
}

function log(db: DB, actor: string, action: string, detail = '', reference?: string) {
  db.audit.unshift({ id: uid(), at: Date.now(), actor, action, detail, reference });
  db.audit = db.audit.slice(0, 500);
}

function validDiscount(db: DB, code: string): DiscountCode | null {
  const c = code.trim().toUpperCase();
  const d = db.discounts.find((x) => x.code === c);
  if (!d || !d.active) return null;
  if (d.expiresOn && d.expiresOn < venueToday(db.settings)) return null;
  if (d.maxUses != null && d.uses >= d.maxUses) return null;
  return d;
}

function guestView(b: Booking): GuestBooking {
  return {
    id: b.id,
    reference: b.reference,
    date: b.date,
    slots: b.slots,
    status: b.status,
    paymentStatus: b.paymentStatus,
    amount: b.amount,
    attendance: b.attendance,
    cancelRequest: b.cancelRequest,
    guestName: b.guest.name,
  };
}

function doCancel(db: DB, b: Booking, actor: string, refund: boolean, reason: string) {
  if (b.status !== 'confirmed' && b.status !== 'held') throw new Error('This booking is not active.');
  b.status = 'cancelled';
  b.cancelledAt = Date.now();
  b.cancelReason = reason;
  b.renterConfirmedCancel = true;
  if (b.paymentStatus === 'paid' && refund) b.paymentStatus = 'refunded';
  if (b.paymentStatus === 'pending') b.paymentStatus = 'unpaid';
  if (b.cancelRequest?.status === 'pending') b.cancelRequest.status = 'approved';
  delete b.holdExpiresAt;
  log(db, actor, refund ? 'Cancelled and refunded' : 'Cancelled', reason, b.reference);
}

const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 0));

export const demoBackend: Backend = {
  mode: 'demo',

  // ----- Public -----

  async getSettings() {
    return read().settings;
  },

  async getAvailability(from, to) {
    const db = read();
    const occupancy: Occupancy[] = [];
    const now = Date.now();
    for (const b of db.bookings) {
      if (b.date < from || b.date > to || !isActiveBooking(b, now)) continue;
      for (const x of b.slots) {
        occupancy.push({
          bookingId: b.id,
          date: b.date,
          courtId: x.courtId,
          hour: x.hour,
          kind: b.status === 'held' ? 'held' : 'booked',
          holdExpiresAt: b.holdExpiresAt,
        });
      }
    }
    return { occupancy, blocks: db.blocks.filter((b) => b.date >= from && b.date <= to) };
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  async checkDiscount(code) {
    const d = validDiscount(read(), code);
    return d ? { code: d.code, kind: d.kind, value: d.value } : null;
  },

  async createHold({ date, slots, guest, discountCode }) {
    return tx((db) => {
      if (guest.name.trim().length < 2) throw new Error('Please enter your name.');
      validateSlots(db.settings, date, slots);
      assertFree(db, date, slots);
      let discount: DiscountCode | null = null;
      if (discountCode?.trim()) {
        discount = validDiscount(db, discountCode);
        if (!discount) throw new Error('That discount code is not valid.');
      }
      const q = quote(db.settings, date, slots, discount);
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
        amount: q.total,
        discountCode: discount?.code,
        discountAmount: q.discountAmount || undefined,
        createdAt: now,
        holdExpiresAt: now + db.settings.holdMinutes * 60_000,
        attendance: 'pending',
      };
      db.bookings.push(b);
      return b;
    });
  },

  async startPayment() {
    return { demo: true };
  },

  async demoPay(id, reference) {
    // Simulates the trip to a payment provider and back.
    await new Promise((r) => setTimeout(r, 1000));
    return tx((db) => {
      const b = getBooking(db, id);
      if (b.reference !== reference) throw new Error('Booking not found.');
      if (b.status !== 'held') {
        throw new Error('Your hold expired before payment finished. Please pick your slot again.');
      }
      b.status = 'confirmed';
      b.paymentStatus = 'paid';
      delete b.holdExpiresAt;
      if (b.discountCode) {
        const d = db.discounts.find((x) => x.code === b.discountCode);
        if (d) d.uses++;
      }
      log(db, 'Guest', 'Booked online', describeSlots(db.settings, b.slots).join(', '), b.reference);
      return { ...b };
    });
  },

  async releaseHold(id, reference) {
    tx((db) => {
      const b = db.bookings.find((x) => x.id === id && x.reference === reference);
      if (b?.status === 'held') {
        b.status = 'expired';
        b.paymentStatus = 'unpaid';
        delete b.holdExpiresAt;
      }
    });
  },

  async findBooking(reference, contact) {
    const ref = reference.trim().toUpperCase();
    const b = read().bookings.find((x) => x.reference === ref && matchesContact(x.guest, contact));
    return b ? guestView(b) : null;
  },

  async requestCancellation(reference, contact, reason) {
    return tx((db) => {
      const ref = reference.trim().toUpperCase();
      const b = db.bookings.find((x) => x.reference === ref && matchesContact(x.guest, contact));
      if (!b) throw new Error('Booking not found.');
      const check = canRequestCancel(db.settings, b);
      if (!check.ok) throw new Error(check.reason);
      b.cancelRequest = { status: 'pending', reason: reason.trim() || 'No reason given', at: Date.now() };
      log(db, 'Guest', 'Requested cancellation', b.cancelRequest.reason, b.reference);
      return guestView(b);
    });
  },

  async joinWaitlist(entry) {
    tx((db) => {
      if (entry.guest.name.trim().length < 2) throw new Error('Please enter your name.');
      db.waitlist.push({ ...entry, id: uid(), status: 'waiting', createdAt: Date.now() });
    });
  },

  // ----- Staff -----

  async getSession() {
    return session();
  },

  async signIn() {
    throw new Error('Demo mode has no passwords. Use the demo sign-in buttons.');
  },

  async demoSignIn(role: Role) {
    const s: StaffSession =
      role === 'owner'
        ? { name: 'Demo Owner', email: 'owner@demo', role }
        : { name: 'Demo Staff', email: 'staff@demo', role };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  },

  async signOut() {
    sessionStorage.removeItem(SESSION_KEY);
  },

  async listBookings(from, to) {
    requireStaff();
    return read().bookings.filter((b) => (!from || b.date >= from) && (!to || b.date <= to));
  },

  async listBlocks(from, to) {
    return read().blocks.filter((b) => b.date >= from && b.date <= to);
  },

  async createBooking({ date, slots, guest, source, paid, notes, seriesId }) {
    const me = requireStaff();
    return tx((db) => {
      if (guest.name.trim().length < 2) throw new Error('Enter the guest name.');
      validateSlots(db.settings, date, slots, true);
      assertFree(db, date, slots);
      const b: Booking = {
        id: uid(),
        reference: makeReference(),
        date,
        slots,
        guest,
        status: 'confirmed',
        paymentStatus: paid ? 'paid' : 'unpaid',
        source,
        amount: quote(db.settings, date, slots).total,
        createdAt: Date.now(),
        notes,
        attendance: 'pending',
        seriesId,
      };
      db.bookings.push(b);
      log(db, me.name, 'Booking created', `${source} · ${describeSlots(db.settings, slots).join(', ')}`, b.reference);
      return b;
    });
  },

  async updateBooking(id, patch) {
    const me = requireStaff();
    tx((db) => {
      const b = getBooking(db, id);
      if (patch.guest.name.trim().length < 2) throw new Error('Enter the guest name.');
      b.guest = patch.guest;
      b.notes = patch.notes || undefined;
      log(db, me.name, 'Booking edited', 'Guest details or notes', b.reference);
    });
  },

  async rescheduleBooking(id, date, slots) {
    const me = requireStaff();
    tx((db) => {
      const b = getBooking(db, id);
      if (b.status !== 'confirmed') throw new Error('Only confirmed bookings can be moved.');
      validateSlots(db.settings, date, slots);
      assertFree(db, date, slots, id);
      const before = describeSlots(db.settings, b.slots).join(', ');
      b.date = date;
      b.slots = slots;
      b.amount = Math.max(0, quote(db.settings, date, slots).subtotal - (b.discountAmount ?? 0));
      log(db, me.name, 'Rescheduled', `${before} → ${date} ${describeSlots(db.settings, slots).join(', ')}`, b.reference);
    });
  },

  async cancelBooking(id, { renterConfirmed, refund, reason }) {
    const me = requireStaff();
    if (!renterConfirmed) throw new Error('Confirm with the renter before cancelling.');
    if (refund && me.role !== 'owner') throw new Error('Only the owner can refund.');
    tx((db) => doCancel(db, getBooking(db, id), me.name, refund, reason.trim() || 'Cancelled by venue'));
  },

  async resolveCancelRequest(id, approve, refund) {
    const me = requireStaff();
    if (refund && me.role !== 'owner') throw new Error('Only the owner can refund.');
    tx((db) => {
      const b = getBooking(db, id);
      if (b.cancelRequest?.status !== 'pending') throw new Error('There is no pending request.');
      if (approve) {
        doCancel(db, b, me.name, refund, `Renter's request: ${b.cancelRequest.reason}`);
      } else {
        b.cancelRequest.status = 'declined';
        log(db, me.name, 'Declined cancellation request', '', b.reference);
      }
    });
  },

  async setAttendance(id, attendance) {
    const me = requireStaff();
    tx((db) => {
      const b = getBooking(db, id);
      if (b.status !== 'confirmed') throw new Error('Only confirmed bookings can be checked in.');
      if (b.date > venueToday(db.settings)) throw new Error('You can only check in on the day of the booking.');
      b.attendance = attendance;
      b.checkedInAt = attendance === 'checked-in' ? Date.now() : undefined;
      const label = { 'checked-in': 'Checked in', 'no-show': 'Marked no-show', pending: 'Attendance reset' }[attendance];
      log(db, me.name, label, b.guest.name, b.reference);
    });
  },

  async markPaid(id) {
    const me = requireStaff();
    tx((db) => {
      const b = getBooking(db, id);
      b.paymentStatus = 'paid';
      log(db, me.name, 'Marked as paid', '', b.reference);
    });
  },

  async resendConfirmation(id) {
    const me = requireStaff();
    return tx((db) => {
      const b = getBooking(db, id);
      log(db, me.name, 'Confirmation resent (demo)', b.guest.email || b.guest.phone, b.reference);
      return { sent: false, message: 'Demo mode: no email was sent. Connect Supabase and an email provider to send real emails.' };
    });
  },

  async addBlock(block) {
    const me = requireStaff();
    tx((db) => {
      if (block.endHour <= block.startHour) throw new Error('End time must be after start time.');
      if (!block.reason.trim()) throw new Error('Add a reason.');
      db.blocks.push({ ...block, id: uid() });
      log(db, me.name, 'Closed off time', `${block.date} · ${block.reason}`);
    });
  },

  async removeBlock(id) {
    const me = requireStaff();
    tx((db) => {
      const bl = db.blocks.find((b) => b.id === id);
      db.blocks = db.blocks.filter((b) => b.id !== id);
      if (bl) log(db, me.name, 'Removed closure', `${bl.date} · ${bl.reason}`);
    });
  },

  async updateSettings(s) {
    const me = requireOwner();
    tx((db) => {
      if (!s.courts.length) throw new Error('Add at least one court.');
      db.settings = s;
      log(db, me.name, 'Settings updated');
    });
  },

  async listDiscounts() {
    requireStaff();
    return read().discounts;
  },

  async saveDiscount(d) {
    const me = requireOwner();
    tx((db) => {
      const code = d.code.trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,20}$/.test(code)) throw new Error('Codes are 3–20 letters, numbers or dashes.');
      if (d.value <= 0 || (d.kind === 'percent' && d.value > 100)) throw new Error('Enter a valid discount amount.');
      const existing = db.discounts.find((x) => x.code === code);
      if (existing) Object.assign(existing, { ...d, code, uses: existing.uses });
      else db.discounts.push({ ...d, code, uses: 0 });
      log(db, me.name, existing ? 'Discount updated' : 'Discount created', code);
    });
  },

  async deleteDiscount(code) {
    const me = requireOwner();
    tx((db) => {
      db.discounts = db.discounts.filter((d) => d.code !== code);
      log(db, me.name, 'Discount deleted', code);
    });
  },

  async listWaitlist(from) {
    requireStaff();
    return read().waitlist.filter((w) => !from || w.date >= from);
  },

  async updateWaitlist(id, status) {
    const me = requireStaff();
    tx((db) => {
      const w = db.waitlist.find((x) => x.id === id);
      if (!w) throw new Error('Not found.');
      w.status = status;
      log(db, me.name, `Waitlist: ${status}`, w.guest.name);
    });
  },

  async listCustomerNotes() {
    requireStaff();
    return read().notes;
  },

  async saveCustomerNote(note) {
    requireStaff();
    tx((db) => {
      db.notes = [...db.notes.filter((n) => n.key !== note.key), note];
    });
  },

  async listAudit(limit = 200) {
    requireStaff();
    return read().audit.slice(0, limit);
  },

  async resetDemo() {
    write(seed());
    return delay(undefined);
  },
};

// ---------- Demo seed ----------

function seed(): DB {
  const settings = structuredClone(defaultSettings);
  const names: [string, string][] = [
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
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;

  const today = venueToday(settings);
  const now = venueNow(settings.timezone);
  const db: DB = { settings, bookings: [], blocks: [], waitlist: [], discounts: [], notes: [], audit: [] };

  db.blocks.push({
    id: uid(),
    date: addDays(today, 2),
    courtId: settings.courts[2].id,
    startHour: settings.hours[0].open,
    endHour: settings.hours[0].open + 2,
    reason: 'Court maintenance',
  });

  for (let d = -14; d < 10; d++) {
    const date = addDays(today, d);
    const hours = hoursList(settings, date);
    for (const court of settings.courts) {
      let i = 0;
      while (i < hours.length) {
        const h = hours[i];
        const busy = h >= 17 ? 0.55 : h <= 8 ? 0.35 : 0.18;
        if (rand() >= busy) {
          i++;
          continue;
        }
        const len = Math.min(rand() < 0.4 ? 2 : 1, hours.length - i);
        const [name, phone] = names[Math.floor(rand() * names.length)];
        const slots = Array.from({ length: len }, (_, k) => ({ courtId: court.id, hour: h + k }));
        const source = rand() < 0.75 ? 'online' : rand() < 0.5 ? 'walk-in' : 'phone';
        const past = d < 0 || (d === 0 && h + len <= now.hour);
        const r = rand();
        const b: Booking = {
          id: uid(),
          reference: makeReference(),
          date,
          slots,
          guest: { name, phone, email: `${name.split(' ')[0].toLowerCase()}@example.com` },
          status: past && r < 0.06 ? 'cancelled' : 'confirmed',
          paymentStatus: source === 'online' || rand() < 0.6 ? 'paid' : 'unpaid',
          source,
          amount: quote(settings, date, slots).total,
          createdAt: Date.now() - Math.floor((rand() * 5 + Math.max(0, -d)) * 86_400_000),
          attendance: past ? (r < 0.12 ? 'no-show' : 'checked-in') : 'pending',
          demo: true,
        };
        try {
          assertFree(db, date, slots);
          db.bookings.push(b);
        } catch {
          /* overlaps the maintenance block */
        }
        i += len;
      }
    }
  }

  // A pending cancellation request and a waitlist entry, so those screens have something to show.
  const upcoming = db.bookings.find((b) => b.date === addDays(today, 3) && b.status === 'confirmed');
  if (upcoming) upcoming.cancelRequest = { status: 'pending', reason: 'Work came up, sorry!', at: Date.now() - 3_600_000 };
  db.waitlist.push({
    id: uid(),
    date: addDays(today, 1),
    courtId: null,
    hour: 18,
    guest: { name: 'Pat Lim', phone: '0917 555 0110', email: 'pat@example.com' },
    status: 'waiting',
    createdAt: Date.now() - 7_200_000,
  });
  db.discounts.push({ code: 'WELCOME10', kind: 'percent', value: 10, active: true, uses: 3 });

  return db;
}
