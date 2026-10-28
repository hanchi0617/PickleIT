/** Local calendar date at the venue, "YYYY-MM-DD". */
export type DateKey = string;

export interface Slot {
  courtId: string;
  /** Start hour, 24h clock. Each slot is one hour. */
  hour: number;
}

export interface Guest {
  name: string;
  phone: string;
  email: string;
}

export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired';
export type PaymentStatus = 'pending' | 'paid' | 'unpaid' | 'refunded';
export type BookingSource = 'online' | 'walk-in' | 'phone' | 'recurring';
export type Attendance = 'pending' | 'checked-in' | 'no-show';
export type CancelRequestStatus = 'pending' | 'approved' | 'declined';

export interface Booking {
  id: string;
  reference: string;
  date: DateKey;
  slots: Slot[];
  guest: Guest;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  source: BookingSource;
  /** Amount charged, after any discount. */
  amount: number;
  discountCode?: string;
  discountAmount?: number;
  createdAt: number;
  /** Only set while status is "held". */
  holdExpiresAt?: number;
  notes?: string;
  attendance: Attendance;
  checkedInAt?: number;
  /** Set when the renter asks to cancel from their side. */
  cancelRequest?: { status: CancelRequestStatus; reason: string; at: number };
  cancelledAt?: number;
  cancelReason?: string;
  renterConfirmedCancel?: boolean;
  /** Shared by every booking created from one recurring series. */
  seriesId?: string;
  demo?: boolean;
}

/** What a renter can see about their own booking (no contact details). */
export type GuestBooking = Pick<
  Booking,
  'id' | 'reference' | 'date' | 'slots' | 'status' | 'paymentStatus' | 'amount' | 'attendance' | 'cancelRequest'
> & { guestName: string };

/** A taken slot as the public sees it: no personal details. */
export interface Occupancy {
  bookingId: string;
  date: DateKey;
  courtId: string;
  hour: number;
  kind: 'held' | 'booked';
  holdExpiresAt?: number;
}

export interface Block {
  id: string;
  date: DateKey;
  /** "all" closes every court. */
  courtId: string;
  startHour: number;
  endHour: number;
  reason: string;
}

export type WaitlistStatus = 'waiting' | 'contacted' | 'booked' | 'removed';

export interface WaitlistEntry {
  id: string;
  date: DateKey;
  /** null means any court. */
  courtId: string | null;
  hour: number;
  guest: Guest;
  status: WaitlistStatus;
  createdAt: number;
}

export interface DiscountCode {
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  active: boolean;
  expiresOn?: DateKey;
  maxUses?: number;
  uses: number;
}

export interface CustomerNote {
  /** Normalised phone number, or email when there is no phone. */
  key: string;
  notes: string;
  flagged: boolean;
}

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  action: string;
  detail: string;
  reference?: string;
}

export type Role = 'owner' | 'staff';

export interface StaffSession {
  name: string;
  email: string;
  role: Role;
}

// ---------- Settings (editable by the owner in the admin) ----------

export interface CourtSetting {
  id: string;
  name: string;
  note: string;
  pricePerHour: number;
  active: boolean;
}

export interface DayHours {
  open: number;
  /** Exclusive: 22 means the last slot starts at 9PM. */
  close: number;
  closed: boolean;
}

export interface Settings {
  timezone: string;
  currencySymbol: string;
  courts: CourtSetting[];
  /** Seven entries, Sunday first. */
  hours: DayHours[];
  holidays: { date: DateKey; reason: string }[];
  peak: { enabled: boolean; days: number[]; startHour: number; endHour: number; pricePerHour: number };
  holdMinutes: number;
  maxDaysAhead: number;
  cancellation: { allowRequests: boolean; minHoursBefore: number; refundPercent: number };
  reminders: { hoursBefore: number; email: boolean };
  templates: { confirmation: string; reminder: string };
}

// ---------- Grid cells ----------

export type SlotState =
  | { kind: 'open' }
  | { kind: 'past' }
  | { kind: 'closed' }
  | { kind: 'blocked'; block: Block }
  | { kind: 'booked' | 'held' | 'mine'; bookingId: string; booking?: Booking };

export class SlotTakenError extends Error {
  constructor(public slots: Slot[] = []) {
    super('Some of the selected hours were just taken. Please pick another time.');
    this.name = 'SlotTakenError';
  }
}
