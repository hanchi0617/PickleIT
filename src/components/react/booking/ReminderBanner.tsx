import { useEffect, useState } from 'react';
import type { MyBooking } from '../../../lib/booking/myBookings';
import { describeSlots, endHour, formatDate, hoursUntil, startHour } from '../../../lib/booking/utils';
import { Icon, icons } from '../ui';
import { useNow, useSettings } from './hooks';
import { useMyBookings } from './MyBookings';

const DISMISSED = 'pickleit.dismissed-reminders';

// Site-wide strip reminding the renter of a booking coming up soon (within the
// reminder window set by the venue, 24 hours by default).
export default function ReminderBanner() {
  const settings = useSettings();
  const list = useMyBookings();
  useNow(60_000);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem(DISMISSED) ?? '[]'));
    } catch {
      /* ignore */
    }
  }, []);

  if (!settings) return null;

  const next = list
    .filter((b: MyBooking) => b.status === 'confirmed' && !dismissed.includes(b.id))
    .map((b) => ({ b, until: hoursUntil(settings, b.date, startHour(b.slots)), left: hoursUntil(settings, b.date, endHour(b.slots)) }))
    .filter((x) => x.left > 0 && x.until <= settings.reminders.hoursBefore)
    .sort((a, z) => a.until - z.until)[0];

  if (!next) return null;

  const { b, until } = next;
  const when =
    until <= 0 ? 'happening now' : until < 1 ? 'starting soon' : until < 24 ? `in ${Math.round(until)} hour${Math.round(until) === 1 ? '' : 's'}` : formatDate(b.date);

  const dismiss = () => {
    const d = [...dismissed, b.id];
    setDismissed(d);
    try {
      localStorage.setItem(DISMISSED, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="border-b border-aurora/25 bg-aurora/10 text-sm" role="status">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-2.5">
        <Icon d={icons.bell} className="size-4 shrink-0 text-aurora" />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-aurora">Reminder:</span> {describeSlots(settings, b.slots).join(', ')}{' '}
          <span className="text-mist">· {when}</span>
        </p>
        <a href="/book#my-bookings" className="btn btn-secondary btn-sm hidden sm:inline-flex">
          View
        </a>
        <button type="button" onClick={dismiss} className="btn btn-ghost btn-sm" aria-label="Dismiss reminder">
          <Icon d={icons.x} />
        </button>
      </div>
    </div>
  );
}
