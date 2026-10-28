// Shared helpers for the PickleIT edge functions (Deno).
import { createClient } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Client with the service role: bypasses row level security. Server-side only. */
export function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/** Client acting as the caller (their JWT), so RLS and role checks apply. */
export function callerClient(req: Request) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
}

interface BookingRow {
  reference: string;
  date: string;
  slots: { courtId: string; hour: number }[];
  guest_name: string;
  guest_email: string;
  amount: number;
}

interface Settings {
  currencySymbol: string;
  courts: { id: string; name: string }[];
  templates: { confirmation: string; reminder: string };
}

const fmtHour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 || h === 24 ? 'AM' : 'PM'}`;

/** Same placeholders as fillTemplate() in src/lib/booking/utils.ts. */
export function fillTemplate(s: Settings, template: string, b: BookingRow) {
  const courts = [...new Set(b.slots.map((x) => s.courts.find((c) => c.id === x.courtId)?.name ?? x.courtId))];
  const hours = b.slots.map((x) => x.hour).sort((a, z) => a - z);
  const date = new Date(`${b.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return template
    .replaceAll('{name}', b.guest_name.split(' ')[0] || b.guest_name)
    .replaceAll('{reference}', b.reference)
    .replaceAll('{court}', courts.join(', '))
    .replaceAll('{date}', date)
    .replaceAll('{time}', `${fmtHour(hours[0])} – ${fmtHour(hours[hours.length - 1] + 1)}`)
    .replaceAll('{amount}', `${s.currencySymbol}${Number(b.amount).toLocaleString()}`);
}

/**
 * Sends an email through Resend (https://resend.com). Needs RESEND_API_KEY
 * and EMAIL_FROM secrets. Returns false when email isn't configured.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!key || !from || !to) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) console.error('Resend error', res.status, await res.text());
  return res.ok;
}

export async function sendConfirmation(bookingId: string): Promise<boolean> {
  const db = adminClient();
  const [{ data: b }, { data: s }] = await Promise.all([
    db.from('bookings').select('*').eq('id', bookingId).single(),
    db.from('settings').select('data').eq('id', 1).single(),
  ]);
  if (!b || !s) return false;
  const sent = await sendEmail(b.guest_email, `Your court is booked · ${b.reference}`, fillTemplate(s.data, s.data.templates.confirmation, b));
  if (sent) await db.from('bookings').update({ confirmation_sent_at: new Date().toISOString() }).eq('id', bookingId);
  return sent;
}
