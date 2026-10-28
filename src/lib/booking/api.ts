// The one place the UI talks to for data.
//
// If PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are set (see
// .env.example), everything goes to the Supabase database. Otherwise the site
// runs in demo mode, storing data in this browser only, so the whole flow can
// be tried without a backend.

import type {
  Attendance,
  AuditEntry,
  Block,
  Booking,
  BookingSource,
  CustomerNote,
  DateKey,
  DiscountCode,
  Guest,
  GuestBooking,
  Occupancy,
  Role,
  Settings,
  Slot,
  StaffSession,
  WaitlistEntry,
  WaitlistStatus,
} from './types';

export interface Backend {
  mode: 'demo' | 'supabase';

  // ----- Public -----
  getSettings(): Promise<Settings>;
  getAvailability(from: DateKey, to: DateKey): Promise<{ occupancy: Occupancy[]; blocks: Block[] }>;
  /** Calls `fn` whenever bookings, closures or settings change. */
  subscribe(fn: () => void): () => void;
  checkDiscount(code: string): Promise<Pick<DiscountCode, 'code' | 'kind' | 'value'> | null>;
  createHold(input: { date: DateKey; slots: Slot[]; guest: Guest; discountCode?: string }): Promise<Booking>;
  /** Returns a checkout URL, or demo: true when no payment provider is connected. */
  startPayment(id: string, reference: string): Promise<{ url?: string; demo: boolean }>;
  /** Demo-only stand-in for a real payment. Disabled on the server for launch. */
  demoPay(id: string, reference: string): Promise<Booking>;
  releaseHold(id: string, reference: string): Promise<void>;
  /** `contact` is the email or mobile number used when booking. */
  findBooking(reference: string, contact: string): Promise<GuestBooking | null>;
  requestCancellation(reference: string, contact: string, reason: string): Promise<GuestBooking>;
  joinWaitlist(entry: { date: DateKey; courtId: string | null; hour: number; guest: Guest }): Promise<void>;

  // ----- Staff -----
  getSession(): Promise<StaffSession | null>;
  signIn(email: string, password: string): Promise<StaffSession>;
  /** Demo mode only: sign in as a role without a password. */
  demoSignIn?(role: Role): Promise<StaffSession>;
  signOut(): Promise<void>;

  listBookings(from?: DateKey, to?: DateKey): Promise<Booking[]>;
  listBlocks(from: DateKey, to: DateKey): Promise<Block[]>;
  createBooking(input: {
    date: DateKey;
    slots: Slot[];
    guest: Guest;
    source: Exclude<BookingSource, 'online'>;
    paid: boolean;
    notes?: string;
    seriesId?: string;
  }): Promise<Booking>;
  updateBooking(id: string, patch: { guest: Guest; notes: string }): Promise<void>;
  rescheduleBooking(id: string, date: DateKey, slots: Slot[]): Promise<void>;
  /** Staff can only cancel once the renter has confirmed. Refunds are owner-only. */
  cancelBooking(id: string, opts: { renterConfirmed: boolean; refund: boolean; reason: string }): Promise<void>;
  resolveCancelRequest(id: string, approve: boolean, refund: boolean): Promise<void>;
  setAttendance(id: string, attendance: Attendance): Promise<void>;
  markPaid(id: string): Promise<void>;
  resendConfirmation(id: string): Promise<{ sent: boolean; message: string }>;
  addBlock(block: Omit<Block, 'id'>): Promise<void>;
  removeBlock(id: string): Promise<void>;

  updateSettings(s: Settings): Promise<void>;
  listDiscounts(): Promise<DiscountCode[]>;
  saveDiscount(d: DiscountCode): Promise<void>;
  deleteDiscount(code: string): Promise<void>;
  listWaitlist(from?: DateKey): Promise<WaitlistEntry[]>;
  updateWaitlist(id: string, status: WaitlistStatus): Promise<void>;
  listCustomerNotes(): Promise<CustomerNote[]>;
  saveCustomerNote(note: CustomerNote): Promise<void>;
  listAudit(limit?: number): Promise<AuditEntry[]>;
  resetDemo?(): Promise<void>;
}

const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

let backend: Promise<Backend> | null = null;

export function api(): Promise<Backend> {
  backend ??=
    url && key
      ? import('./supabase').then((m) => m.createSupabaseBackend(url, key))
      : import('./demo').then((m) => m.demoBackend);
  return backend;
}
