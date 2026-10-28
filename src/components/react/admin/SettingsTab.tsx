import { useState } from 'react';
import type { CourtSetting, Settings } from '../../../lib/booking/types';
import { formatDate, formatHour, uid } from '../../../lib/booking/utils';
import { Alert, Field } from '../ui';
import { act, type AdminCtx } from './shared';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Owner-only: courts, prices, hours, holidays, policies and email templates.
export default function SettingsTab({ ctx }: { ctx: AdminCtx }) {
  const [s, setS] = useState<Settings>(() => structuredClone(ctx.settings));
  const [holiday, setHoliday] = useState({ date: '', reason: '' });
  const dirty = JSON.stringify(s) !== JSON.stringify(ctx.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setCourt = (i: number, patch: Partial<CourtSetting>) => set('courts', s.courts.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const hourSelect = (value: number, onChange: (v: number) => void, from = 0, to = 24) => (
    <select className="input !py-2" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => (
        <option key={h} value={h}>{h === 24 ? 'Midnight' : formatHour(h)}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-6 pb-24">
      <Section title="Courts" text="Rename courts, set the hourly price, or take a court out of service.">
        <div className="space-y-3">
          {s.courts.map((c, i) => (
            <div key={c.id} className="grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
              <Field label="Name">
                <input className="input" value={c.name} onChange={(e) => setCourt(i, { name: e.target.value })} />
              </Field>
              <Field label="Description">
                <input className="input" value={c.note} onChange={(e) => setCourt(i, { note: e.target.value })} />
              </Field>
              <Field label={`Price / hour (${s.currencySymbol})`}>
                <input type="number" min={0} className="input" value={c.pricePerHour} onChange={(e) => setCourt(i, { pricePerHour: Number(e.target.value) })} />
              </Field>
              <label className="flex items-center gap-2 pb-3 text-sm">
                <input type="checkbox" className="size-4 accent-[#7cff67]" checked={c.active} onChange={(e) => setCourt(i, { active: e.target.checked })} />
                Open for booking
              </label>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm mt-3"
          onClick={() => set('courts', [...s.courts, { id: `c${uid().slice(0, 5)}`, name: `Court ${s.courts.length + 1}`, note: '', pricePerHour: s.courts[0]?.pricePerHour ?? 500, active: true }])}
        >
          + Add court
        </button>
      </Section>

      <Section title="Peak pricing" text="Charge a different hourly rate at busy times. Applies to every court.">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[#7cff67]" checked={s.peak.enabled} onChange={(e) => set('peak', { ...s.peak, enabled: e.target.checked })} />
          Use peak pricing
        </label>
        {s.peak.enabled && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => {
                const on = s.peak.days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    className={`btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => set('peak', { ...s.peak, days: on ? s.peak.days.filter((x) => x !== i) : [...s.peak.days, i].sort() })}
                  >
                    {d.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="From">{hourSelect(s.peak.startHour, (v) => set('peak', { ...s.peak, startHour: v }), 0, 23)}</Field>
              <Field label="Until">{hourSelect(s.peak.endHour, (v) => set('peak', { ...s.peak, endHour: v }), 1, 24)}</Field>
              <Field label={`Price (${s.currencySymbol})`}>
                <input type="number" min={0} className="input !py-2" value={s.peak.pricePerHour} onChange={(e) => set('peak', { ...s.peak, pricePerHour: Number(e.target.value) })} />
              </Field>
            </div>
          </div>
        )}
      </Section>

      <Section title="Opening hours" text="Bookable hours for each day. Close is when the last hour ends.">
        <div className="space-y-2">
          {s.hours.map((h, i) => (
            <div key={DAYS[i]} className="grid grid-cols-[6rem_1fr_1fr_auto] items-center gap-2 sm:gap-3">
              <span className="text-sm">{DAYS[i]}</span>
              {hourSelect(h.open, (v) => set('hours', s.hours.map((x, j) => (j === i ? { ...x, open: v } : x))), 0, 23)}
              {hourSelect(h.close, (v) => set('hours', s.hours.map((x, j) => (j === i ? { ...x, close: v } : x))), 1, 24)}
              <label className="flex items-center gap-2 text-sm text-mist">
                <input type="checkbox" className="size-4 accent-[#7cff67]" checked={h.closed} onChange={(e) => set('hours', s.hours.map((x, j) => (j === i ? { ...x, closed: e.target.checked } : x)))} />
                Closed
              </label>
            </div>
          ))}
        </div>

        <h3 className="mt-6 font-medium">Holidays and full-day closures</h3>
        <ul className="mt-2 divide-y divide-line">
          {s.holidays.map((h) => (
            <li key={h.date} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1">
                {formatDate(h.date, { year: 'numeric' })} · <span className="text-mist">{h.reason}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('holidays', s.holidays.filter((x) => x.date !== h.date))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <input type="date" className="input !w-auto" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} aria-label="Holiday date" />
          <input className="input min-w-0 flex-1" placeholder="Reason, e.g. Christmas Day" value={holiday.reason} onChange={(e) => setHoliday({ ...holiday, reason: e.target.value })} aria-label="Holiday reason" />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!holiday.date}
            onClick={() => {
              set('holidays', [...s.holidays.filter((x) => x.date !== holiday.date), { date: holiday.date, reason: holiday.reason || 'Closed' }].sort((a, z) => a.date.localeCompare(z.date)));
              setHoliday({ date: '', reason: '' });
            }}
          >
            Add
          </button>
        </div>
      </Section>

      <Section title="Booking rules">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Hold slot while paying (minutes)">
            <input type="number" min={2} max={60} className="input" value={s.holdMinutes} onChange={(e) => set('holdMinutes', Number(e.target.value))} />
          </Field>
          <Field label="Book up to (days ahead)">
            <input type="number" min={1} max={365} className="input" value={s.maxDaysAhead} onChange={(e) => set('maxDaysAhead', Number(e.target.value))} />
          </Field>
          <Field label="Currency symbol">
            <input className="input" value={s.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} />
          </Field>
          <Field label="Venue timezone" hint="e.g. Asia/Manila">
            <input className="input" value={s.timezone} onChange={(e) => set('timezone', e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Cancellations" text="Renters can ask to cancel from My bookings. Staff confirm every cancellation.">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-[#7cff67]" checked={s.cancellation.allowRequests} onChange={(e) => set('cancellation', { ...s.cancellation, allowRequests: e.target.checked })} />
          Let renters request cancellation online
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="At least this many hours before">
            <input type="number" min={0} className="input" value={s.cancellation.minHoursBefore} onChange={(e) => set('cancellation', { ...s.cancellation, minHoursBefore: Number(e.target.value) })} />
          </Field>
          <Field label="Refund (%)">
            <input type="number" min={0} max={100} className="input" value={s.cancellation.refundPercent} onChange={(e) => set('cancellation', { ...s.cancellation, refundPercent: Number(e.target.value) })} />
          </Field>
        </div>
      </Section>

      <Section title="Reminders and emails" text="Placeholders: {name} {reference} {court} {date} {time} {amount}">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-[#7cff67]" checked={s.reminders.email} onChange={(e) => set('reminders', { ...s.reminders, email: e.target.checked })} />
            Email renters a reminder
          </label>
          <Field label="Send reminder this many hours before">
            <input type="number" min={1} max={168} className="input" value={s.reminders.hoursBefore} onChange={(e) => set('reminders', { ...s.reminders, hoursBefore: Number(e.target.value) })} />
          </Field>
          <Field label="Confirmation email">
            <textarea className="input min-h-36 font-mono text-sm" value={s.templates.confirmation} onChange={(e) => set('templates', { ...s.templates, confirmation: e.target.value })} />
          </Field>
          <Field label="Reminder email">
            <textarea className="input min-h-36 font-mono text-sm" value={s.templates.reminder} onChange={(e) => set('templates', { ...s.templates, reminder: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="Staff accounts">
        <Alert tone="info">
          {ctx.backend.mode === 'demo'
            ? 'In demo mode, use the Owner and Staff demo sign-ins. With Supabase connected, staff accounts are added in the Supabase dashboard (see supabase/README.md).'
            : 'Add staff in the Supabase dashboard: create the user under Authentication, then add a row to the staff table with their role (owner or staff).'}
        </Alert>
      </Section>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-line bg-ink-2/95 p-3 pl-5 shadow-2xl shadow-black/60 backdrop-blur-xl">
            <p className="flex-1 text-sm">You have unsaved changes</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setS(structuredClone(ctx.settings))}>
              Discard
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => act(ctx, () => ctx.backend.updateSettings(s), 'Settings saved')}>
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-6">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {text && <p className="mb-4 mt-1 text-sm text-mist">{text}</p>}
      {!text && <div className="mb-4" />}
      {children}
    </section>
  );
}
