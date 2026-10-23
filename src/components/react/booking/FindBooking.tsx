import { useState } from 'react';
import * as store from '../../../lib/booking/store';
import type { Booking } from '../../../lib/booking/types';
import { describeSlots, formatDate, formatMoney } from '../../../lib/booking/utils';

const STATUS: Record<Booking['status'], string> = {
  confirmed: 'Confirmed',
  held: 'Awaiting payment',
  cancelled: 'Cancelled',
  expired: 'Expired (not paid)',
};

// Lets a guest look up a booking with the reference from their confirmation.
export default function FindBooking() {
  const [ref, setRef] = useState('');
  const [result, setResult] = useState<Booking | null | undefined>(undefined);

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (ref.trim()) setResult((await store.findByReference(ref)) ?? null);
        }}
      >
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="QD-XXXXXX"
          aria-label="Booking reference"
          className="min-w-0 flex-1 rounded-xl border border-line bg-white/[0.04] px-4 py-3 uppercase tracking-wider text-white placeholder:text-white/25 outline-none focus:border-aurora/60"
        />
        <button className="rounded-xl border border-line px-5 py-3 transition hover:border-aurora/60 hover:text-aurora">Find</button>
      </form>

      {result === null && <p className="mt-3 text-sm text-rose-300">No booking found with that reference.</p>}
      {result && (
        <div className="mt-4 rounded-2xl border border-line p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-semibold">{result.reference}</span>
            <span className={result.status === 'confirmed' ? 'text-aurora' : 'text-mist'}>{STATUS[result.status]}</span>
          </div>
          <p className="mt-2 text-mist">{formatDate(result.date, { weekday: 'long', month: 'long' })}</p>
          <ul className="mt-1">
            {describeSlots(result.slots).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-2 text-mist">
            {formatMoney(result.amount)} · {result.paymentStatus}
          </p>
        </div>
      )}
    </div>
  );
}
