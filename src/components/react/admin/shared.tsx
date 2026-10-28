import type { Backend } from '../../../lib/booking/api';
import type { Booking, Settings, StaffSession } from '../../../lib/booking/types';
import { describeSlots, formatDate } from '../../../lib/booking/utils';
import { Badge, type useToast } from '../ui';

export interface AdminCtx {
  backend: Backend;
  settings: Settings;
  session: StaffSession;
  toast: ReturnType<typeof useToast>;
  isOwner: boolean;
  /** Opens the booking details sheet. */
  openBooking: (b: Booking) => void;
}

/** Runs an admin action and shows a toast with the result. */
export async function act(ctx: AdminCtx, fn: () => Promise<unknown>, success: string): Promise<boolean> {
  try {
    await fn();
    ctx.toast.ok(success);
    return true;
  } catch (e) {
    ctx.toast.error(e);
    return false;
  }
}

export function StatusBadge({ b }: { b: Booking }) {
  if (b.status === 'cancelled') return <Badge tone="dim">Cancelled</Badge>;
  if (b.status === 'expired') return <Badge tone="dim">Expired</Badge>;
  if (b.status === 'held') return <Badge tone="blue">On hold</Badge>;
  if (b.cancelRequest?.status === 'pending') return <Badge tone="amber">Cancel requested</Badge>;
  if (b.attendance === 'checked-in') return <Badge tone="green">Checked in</Badge>;
  if (b.attendance === 'no-show') return <Badge tone="red">No-show</Badge>;
  return <Badge tone="neutral">Confirmed</Badge>;
}

export function PaymentBadge({ b }: { b: Booking }) {
  const tone = { paid: 'green', pending: 'blue', unpaid: 'red', refunded: 'dim' } as const;
  return <Badge tone={tone[b.paymentStatus]}>{b.paymentStatus}</Badge>;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bookingsCsv(s: Settings, list: Booking[]): (string | number)[][] {
  return [
    ['Reference', 'Date', 'Courts and time', 'Guest', 'Phone', 'Email', 'Status', 'Attendance', 'Payment', 'Amount', 'Discount', 'Source', 'Created', 'Notes'],
    ...list.map((b) => [
      b.reference,
      b.date,
      describeSlots(s, b.slots).join('; '),
      b.guest.name,
      b.guest.phone,
      b.guest.email,
      b.status,
      b.attendance,
      b.paymentStatus,
      b.amount,
      b.discountCode ?? '',
      b.source,
      new Date(b.createdAt).toISOString(),
      b.notes ?? '',
    ]),
  ];
}

export function BookingRow({ ctx, b, extra }: { ctx: AdminCtx; b: Booking; extra?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <button type="button" onClick={() => ctx.openBooking(b)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl text-left hover:text-aurora">
        <span className="w-24 font-mono text-xs text-mist">{b.reference}</span>
        <span className="min-w-[8rem] flex-1">
          <span className="block font-medium">{b.guest.name}</span>
          <span className="block text-xs text-mist">{b.guest.phone || b.guest.email}</span>
        </span>
        <span className="min-w-[10rem] text-sm">
          <span className="block">{formatDate(b.date)}</span>
          <span className="block text-xs text-mist">{describeSlots(ctx.settings, b.slots).join(', ')}</span>
        </span>
      </button>
      <span className="flex items-center gap-2">
        <PaymentBadge b={b} />
        <StatusBadge b={b} />
      </span>
      {extra}
    </li>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-mist">{children}</p>;
}
