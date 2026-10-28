// Emails renters a reminder before their booking. Run it every hour with a
// Supabase cron job (see supabase/README.md). Needs RESEND_API_KEY and
// EMAIL_FROM secrets, and Settings → Reminders → Email turned on.
import { adminClient, fillTemplate, json, sendEmail } from '../_shared/common.ts';

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) return json({ error: 'Forbidden' }, 403);

  const db = adminClient();
  const { data: s } = await db.from('settings').select('data').eq('id', 1).single();
  if (!s?.data?.reminders?.email) return json({ skipped: 'Email reminders are off' });

  const { data: due, error } = await db.rpc('due_reminders');
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  for (const b of due ?? []) {
    const ok = await sendEmail(b.guest_email, `Reminder: your court booking ${b.reference}`, fillTemplate(s.data, s.data.templates.reminder, b));
    if (ok) {
      sent++;
      await db.from('bookings').update({ reminder_sent_at: new Date().toISOString() }).eq('id', b.id);
    }
  }
  return json({ due: due?.length ?? 0, sent });
});
