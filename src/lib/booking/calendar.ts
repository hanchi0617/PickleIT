// "Add to calendar" reminders. The .ics file includes alarms, so the
// renter's phone or computer reminds them natively (iOS, Android, desktop).

import { site } from '../../config/site';
import type { Settings, Slot } from './types';
import { describeSlots, slotRuns } from './utils';

interface CalBooking {
  reference: string;
  date: string;
  slots: Slot[];
}

const stamp = (date: string, hour: number) => `${date.replaceAll('-', '')}T${String(hour).padStart(2, '0')}0000`;

function details(s: Settings, b: CalBooking) {
  return `${describeSlots(s, b.slots).join('\n')}\nBooking reference: ${b.reference}\n${site.address}`;
}

/** One calendar event per run of consecutive hours on a court. */
export function icsFile(s: Settings, b: CalBooking): string {
  const esc = (t: string) => t.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const events = slotRuns(b.slots).map((r, i) => [
    'BEGIN:VEVENT',
    `UID:${b.reference}-${i}@pickleit`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;TZID=${s.timezone}:${stamp(b.date, r.start)}`,
    `DTEND;TZID=${s.timezone}:${stamp(b.date, r.end)}`,
    `SUMMARY:${esc(`Pickleball · ${s.courts.find((c) => c.id === r.courtId)?.name ?? 'Court'}`)}`,
    `LOCATION:${esc(site.address)}`,
    `DESCRIPTION:${esc(details(s, b))}`,
    // Reminders: the day before and one hour before.
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Pickleball tomorrow', 'TRIGGER:-P1D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Pickleball in 1 hour', 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT',
  ]);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${site.name}//Booking//EN`, 'CALSCALE:GREGORIAN', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
}

export function downloadIcs(s: Settings, b: CalBooking) {
  const blob = new Blob([icsFile(s, b)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${site.name}-${b.reference}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Google Calendar link for the first run of hours. */
export function googleCalendarUrl(s: Settings, b: CalBooking): string {
  const r = slotRuns(b.slots)[0];
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Pickleball · ${s.courts.find((c) => c.id === r.courtId)?.name ?? 'Court'}`,
    dates: `${stamp(b.date, r.start)}/${stamp(b.date, r.end)}`,
    ctz: s.timezone,
    details: details(s, b),
    location: site.address,
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
