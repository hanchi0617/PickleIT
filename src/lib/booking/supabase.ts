// Supabase backend. All rules (prices, opening hours, double-booking,
// permissions) are enforced by the database functions in
// supabase/migrations; this file only maps between them and the UI types.

import { createClient, type PostgrestError } from '@supabase/supabase-js';
import { defaultSettings } from '../../config/site';
import type { Backend } from './api';
import {
  SlotTakenError,
  type AuditEntry,
  type Block,
  type Booking,
  type CustomerNote,
  type DiscountCode,
  type GuestBooking,
  type Occupancy,
  type Settings,
  type StaffSession,
  type WaitlistEntry,
} from './types';

const ms = (t: string | null | undefined) => (t ? new Date(t).getTime() : undefined);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toBooking(r: Row): Booking {
  return {
    id: r.id,
    reference: r.reference,
    date: r.date,
    slots: r.slots,
    guest: { name: r.guest_name, phone: r.guest_phone, email: r.guest_email },
    status: r.status,
    paymentStatus: r.payment_status,
    source: r.source,
    amount: Number(r.amount),
    discountCode: r.discount_code ?? undefined,
    discountAmount: Number(r.discount_amount) || undefined,
    createdAt: ms(r.created_at)!,
    holdExpiresAt: ms(r.hold_expires_at),
    notes: r.notes ?? undefined,
    attendance: r.attendance,
    checkedInAt: ms(r.checked_in_at),
    cancelRequest: r.cancel_request_status
      ? { status: r.cancel_request_status, reason: r.cancel_request_reason ?? '', at: ms(r.cancel_requested_at)! }
      : undefined,
    cancelledAt: ms(r.cancelled_at),
    cancelReason: r.cancel_reason ?? undefined,
    renterConfirmedCancel: r.renter_confirmed_cancel ?? undefined,
    seriesId: r.series_id ?? undefined,
  };
}

function check(error: PostgrestError | null) {
  if (!error) return;
  if (error.code === '23505' || error.message === 'SLOT_TAKEN') throw new SlotTakenError();
  throw new Error(error.message);
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb = createClient(url, key);
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  let channel: ReturnType<typeof sb.channel> | null = null;
  let timer: number | undefined;

  async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await sb.rpc(fn, args);
    check(error);
    return data as T;
  }

  const backend: Backend = {
    mode: 'supabase',

    // ----- Public -----

    async getSettings() {
      const { data, error } = await sb.from('settings').select('data').eq('id', 1).maybeSingle();
      check(error);
      return { ...defaultSettings, ...(data?.data as Partial<Settings>) };
    },

    async getAvailability(from, to) {
      const [slots, blocks] = await Promise.all([
        sb.from('booking_slots').select('*').eq('active', true).gte('date', from).lte('date', to),
        sb.from('blocks').select('*').gte('date', from).lte('date', to),
      ]);
      check(slots.error);
      check(blocks.error);
      const occupancy: Occupancy[] = (slots.data ?? []).map((r) => ({
        bookingId: r.booking_id,
        date: r.date,
        courtId: r.court_id,
        hour: r.hour,
        kind: r.kind,
        holdExpiresAt: ms(r.hold_expires_at),
      }));
      return { occupancy, blocks: (blocks.data ?? []).map(toBlock) };
    },

    subscribe(fn) {
      listeners.add(fn);
      if (!channel) {
        channel = sb.channel('pickleit-live');
        for (const table of ['booking_slots', 'blocks', 'settings', 'bookings', 'waitlist']) {
          channel.on('postgres_changes', { event: '*', schema: 'public', table }, emit);
        }
        channel.subscribe();
        // Also tick so expired holds free up and past hours grey out.
        timer = window.setInterval(emit, 30_000);
      }
      return () => {
        listeners.delete(fn);
        if (!listeners.size && channel) {
          sb.removeChannel(channel);
          channel = null;
          window.clearInterval(timer);
        }
      };
    },

    async checkDiscount(code) {
      return rpc('check_discount', { p_code: code });
    },

    async createHold({ date, slots, guest, discountCode }) {
      return rpc<Booking>('create_hold', { p_date: date, p_slots: slots, p_guest: guest, p_discount: discountCode || null });
    },

    async startPayment(id, reference) {
      const { data, error } = await sb.functions.invoke('create-checkout', {
        body: { bookingId: id, reference, returnUrl: window.location.origin },
      });
      // No function deployed or no provider key: fall back to the demo button.
      if (error || !data) return { demo: true };
      if (data.error) throw new Error(data.error);
      return data;
    },

    async demoPay(id, reference) {
      return rpc<Booking>('demo_confirm_payment', { p_id: id, p_reference: reference });
    },

    async releaseHold(id, reference) {
      await rpc('release_hold', { p_id: id, p_reference: reference });
    },

    async findBooking(reference, contact) {
      return rpc<GuestBooking | null>('find_booking', { p_reference: reference, p_contact: contact });
    },

    async requestCancellation(reference, contact, reason) {
      return rpc<GuestBooking>('request_cancellation', { p_reference: reference, p_contact: contact, p_reason: reason });
    },

    async joinWaitlist({ date, courtId, hour, guest }) {
      await rpc('join_waitlist', { p_date: date, p_court: courtId, p_hour: hour, p_guest: guest });
    },

    // ----- Staff -----

    async getSession() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      const { data: staff } = await sb.from('staff').select('name, role').eq('user_id', user.id).maybeSingle();
      if (!staff) return null;
      return { name: staff.name, email: user.email ?? '', role: staff.role } satisfies StaffSession;
    },

    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const s = await backend.getSession();
      if (!s) {
        await sb.auth.signOut();
        throw new Error('This account is not set up as staff.');
      }
      return s;
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async listBookings(from, to) {
      let q = sb.from('bookings').select('*').order('date').limit(5000);
      if (from) q = q.gte('date', from);
      if (to) q = q.lte('date', to);
      const { data, error } = await q;
      check(error);
      return (data ?? []).map(toBooking);
    },

    async listBlocks(from, to) {
      const { data, error } = await sb.from('blocks').select('*').gte('date', from).lte('date', to);
      check(error);
      return (data ?? []).map(toBlock);
    },

    async createBooking({ date, slots, guest, source, paid, notes, seriesId }) {
      return rpc<Booking>('admin_create_booking', {
        p_date: date, p_slots: slots, p_guest: guest, p_source: source, p_paid: paid, p_notes: notes ?? null, p_series: seriesId ?? null,
      });
    },

    async updateBooking(id, { guest, notes }) {
      await rpc('admin_update_booking', { p_id: id, p_guest: guest, p_notes: notes });
    },

    async rescheduleBooking(id, date, slots) {
      await rpc('admin_reschedule', { p_id: id, p_date: date, p_slots: slots });
    },

    async cancelBooking(id, { renterConfirmed, refund, reason }) {
      await rpc('admin_cancel', { p_id: id, p_renter_confirmed: renterConfirmed, p_refund: refund, p_reason: reason });
    },

    async resolveCancelRequest(id, approve, refund) {
      await rpc('admin_resolve_cancel_request', { p_id: id, p_approve: approve, p_refund: refund });
    },

    async setAttendance(id, attendance) {
      await rpc('admin_set_attendance', { p_id: id, p_attendance: attendance });
    },

    async markPaid(id) {
      await rpc('admin_mark_paid', { p_id: id });
    },

    async resendConfirmation(id) {
      const { data, error } = await sb.functions.invoke('resend-confirmation', { body: { bookingId: id } });
      if (error) return { sent: false, message: 'The email function is not deployed yet.' };
      return data;
    },

    async addBlock(b) {
      await rpc('admin_add_block', { p_date: b.date, p_court: b.courtId, p_start: b.startHour, p_end: b.endHour, p_reason: b.reason });
    },

    async removeBlock(id) {
      await rpc('admin_remove_block', { p_id: id });
    },

    async updateSettings(s) {
      await rpc('admin_update_settings', { p_data: s });
    },

    async listDiscounts() {
      const { data, error } = await sb.from('discount_codes').select('*').order('created_at');
      check(error);
      return (data ?? []).map(
        (r): DiscountCode => ({
          code: r.code,
          kind: r.kind,
          value: Number(r.value),
          active: r.active,
          expiresOn: r.expires_on ?? undefined,
          maxUses: r.max_uses ?? undefined,
          uses: r.uses,
        }),
      );
    },

    async saveDiscount(d) {
      await rpc('admin_save_discount', {
        p_code: d.code, p_kind: d.kind, p_value: d.value, p_active: d.active, p_expires: d.expiresOn ?? null, p_max_uses: d.maxUses ?? null,
      });
    },

    async deleteDiscount(code) {
      await rpc('admin_delete_discount', { p_code: code });
    },

    async listWaitlist(from) {
      let q = sb.from('waitlist').select('*').order('date');
      if (from) q = q.gte('date', from);
      const { data, error } = await q;
      check(error);
      return (data ?? []).map(
        (r): WaitlistEntry => ({
          id: r.id,
          date: r.date,
          courtId: r.court_id,
          hour: r.hour,
          guest: { name: r.guest_name, phone: r.guest_phone, email: r.guest_email },
          status: r.status,
          createdAt: ms(r.created_at)!,
        }),
      );
    },

    async updateWaitlist(id, status) {
      const { error } = await sb.from('waitlist').update({ status }).eq('id', id);
      check(error);
    },

    async listCustomerNotes() {
      const { data, error } = await sb.from('customer_notes').select('key, notes, flagged');
      check(error);
      return (data ?? []) as CustomerNote[];
    },

    async saveCustomerNote(n) {
      const { error } = await sb.from('customer_notes').upsert({ ...n, updated_at: new Date().toISOString() });
      check(error);
    },

    async listAudit(limit = 200) {
      const { data, error } = await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit);
      check(error);
      return (data ?? []).map(
        (r): AuditEntry => ({ id: String(r.id), at: ms(r.at)!, actor: r.actor, action: r.action, detail: r.detail, reference: r.reference ?? undefined }),
      );
    },
  };

  return backend;
}

function toBlock(r: Row): Block {
  return { id: r.id, date: r.date, courtId: r.court_id, startHour: r.start_hour, endHour: r.end_hour, reason: r.reason };
}
