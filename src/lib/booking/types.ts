import type { CourtId } from '../../config/site';

export type { CourtId };

/** Local calendar date, "YYYY-MM-DD". */
export type DateKey = string;

export interface Slot {
  courtId: CourtId;
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
export type BookingSource = 'online' | 'walk-in' | 'phone';

export interface Booking {
  id: string;
  reference: string;
  date: DateKey;
  slots: Slot[];
  guest: Guest;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  source: BookingSource;
  amount: number;
  createdAt: number;
  /** Only set while status is "held". */
  holdExpiresAt?: number;
  notes?: string;
  demo?: boolean;
}

export interface Block {
  id: string;
  date: DateKey;
  /** "all" blocks every court. */
  courtId: CourtId | 'all';
  startHour: number;
  endHour: number;
  reason: string;
}

export type SlotState =
  | { kind: 'open' }
  | { kind: 'past' }
  | { kind: 'booked'; booking: Booking }
  | { kind: 'held'; booking: Booking }
  | { kind: 'blocked'; block: Block };

export class SlotTakenError extends Error {
  constructor(public slots: Slot[]) {
    super('Some of the selected slots were just taken. Please pick another time.');
    this.name = 'SlotTakenError';
  }
}
