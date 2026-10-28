import type { Settings } from '../lib/booking/types';

// Branding and venue details. Values marked PLACEHOLDER still need
// confirming before launch.
export const site = {
  name: 'PickleIT',
  shortName: 'PickleIT',
  tagline: 'Three courts. Zero waiting. Book in under a minute.',
  // PLACEHOLDER: replace with the real address, phone and email.
  address: '123 Rally Street, Your City',
  phone: '+00 000 000 0000',
  email: 'hello@thequadpickleball.com',
};

// Starting values for the booking settings. Once a database is connected the
// owner edits these in Admin → Settings, and the saved copy wins.
export const defaultSettings: Settings = {
  // PLACEHOLDER: venue timezone and currency not yet confirmed.
  timezone: 'Asia/Manila',
  currencySymbol: '₱',
  courts: [
    { id: 'c1', name: 'Court 1', note: 'Championship court', pricePerHour: 500, active: true },
    { id: 'c2', name: 'Court 2', note: 'Center court', pricePerHour: 500, active: true },
    { id: 'c3', name: 'Court 3', note: 'Practice-friendly', pricePerHour: 500, active: true },
  ],
  // PLACEHOLDER: operating hours not yet confirmed. Sunday first.
  hours: Array.from({ length: 7 }, () => ({ open: 6, close: 22, closed: false })),
  holidays: [],
  peak: { enabled: false, days: [1, 2, 3, 4, 5], startHour: 17, endHour: 21, pricePerHour: 600 },
  holdMinutes: 10,
  maxDaysAhead: 60,
  cancellation: { allowRequests: true, minHoursBefore: 24, refundPercent: 100 },
  reminders: { hoursBefore: 24, email: true },
  templates: {
    confirmation:
      'Hi {name}, your court is booked!\n\n{court}\n{date}, {time}\nReference: {reference}\nTotal: {amount}\n\nSee you on court.',
    reminder:
      'Hi {name}, this is a reminder that you have {court} booked on {date}, {time}.\nReference: {reference}',
  },
};

// React Bits "Aurora" style colour stops, tuned to aurora green.
export const auroraColors = ['#00e5a0', '#7cff67', '#00b8a9'] as const;
