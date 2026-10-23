// Central place for business details. Values marked PLACEHOLDER still need
// confirming before launch.

export const site = {
  name: 'The Quad Pickleball',
  shortName: 'The Quad',
  tagline: 'Three courts. Zero waiting. Book in under a minute.',
  // PLACEHOLDER: replace with the real address, phone and email.
  address: '123 Rally Street, Your City',
  phone: '+00 000 000 0000',
  email: 'hello@thequadpickleball.com',
};

export const booking = {
  // PLACEHOLDER: currency not yet confirmed.
  currencySymbol: '₱',
  pricePerHour: 500,
  // PLACEHOLDER: operating hours not yet confirmed. 24h clock, close is exclusive.
  openHour: 6,
  closeHour: 22,
  // How long a slot is held while the guest pays.
  holdMinutes: 10,
  // How far ahead guests can book.
  maxDaysAhead: 60,
  courts: [
    { id: 'c1', name: 'Court 1', note: 'Championship court' },
    { id: 'c2', name: 'Court 2', note: 'Center court' },
    { id: 'c3', name: 'Court 3', note: 'Practice-friendly' },
  ],
} as const;

export type CourtId = (typeof booking.courts)[number]['id'];

// React Bits "Aurora" style colour stops, tuned to aurora green.
export const auroraColors = ['#00e5a0', '#7cff67', '#00b8a9'] as const;
