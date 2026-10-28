// Bookings made on this device, remembered so the renter can see their own
// slots highlighted on the calendar, get reminders and find them again
// without an account. Only the reference and the contact used to look the
// booking up are stored; the server still checks both.

import type { DateKey, GuestBooking, Slot } from './types';

const KEY = 'pickleit.my-bookings';
const EVENT = 'pickleit:my-bookings';

export interface MyBooking {
  id: string;
  reference: string;
  /** Email used when booking; needed to look the booking up again. */
  contact: string;
  date: DateKey;
  slots: Slot[];
  amount: number;
  status: GuestBooking['status'];
  cancelRequest?: GuestBooking['cancelRequest'];
  attendance?: GuestBooking['attendance'];
  savedAt: number;
}

export function getMyBookings(): MyBooking[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyBooking[];
  } catch {
    return [];
  }
}

function save(list: MyBooking[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: bookings still work, just aren't remembered */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function saveMyBooking(b: MyBooking) {
  save([...getMyBookings().filter((x) => x.id !== b.id), b]);
}

/** Refreshes a saved booking with the latest status from the server. */
export function updateMyBooking(view: GuestBooking) {
  const list = getMyBookings();
  const i = list.findIndex((x) => x.id === view.id);
  if (i < 0) return;
  list[i] = {
    ...list[i],
    date: view.date,
    slots: view.slots,
    amount: view.amount,
    status: view.status,
    cancelRequest: view.cancelRequest,
    attendance: view.attendance,
  };
  save(list);
}

export function removeMyBooking(id: string) {
  save(getMyBookings().filter((x) => x.id !== id));
}

export function onMyBookingsChange(fn: () => void): () => void {
  const storage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', storage);
  };
}
