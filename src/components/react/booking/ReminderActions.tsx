import { downloadIcs, googleCalendarUrl } from '../../../lib/booking/calendar';
import type { Settings, Slot } from '../../../lib/booking/types';
import { Icon, icons } from '../ui';

// "Add to calendar" buttons. The calendar file carries two alarms (a day
// before and an hour before), so the phone itself reminds the renter.
export default function ReminderActions({
  settings,
  booking,
  size = 'md',
}: {
  settings: Settings;
  booking: { reference: string; date: string; slots: Slot[] };
  size?: 'sm' | 'md';
}) {
  const btn = `btn btn-secondary ${size === 'sm' ? 'btn-sm' : ''}`;
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btn} onClick={() => downloadIcs(settings, booking)}>
        <Icon d={icons.bell} /> Add reminder to calendar
      </button>
      <a className={btn} href={googleCalendarUrl(settings, booking)} target="_blank" rel="noopener noreferrer">
        <Icon d={icons.calendar} /> Google Calendar
      </a>
    </div>
  );
}
