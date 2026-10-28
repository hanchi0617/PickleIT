// Staff action: email the booking confirmation to the renter again.
import { callerClient, cors, json, sendConfirmation } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Only staff may call this: check with the caller's own token.
  const caller = callerClient(req);
  const { data: isStaff } = await caller.rpc('is_staff');
  if (!isStaff) return json({ error: 'Please sign in as staff.' }, 403);

  const { bookingId } = await req.json().catch(() => ({}));
  const sent = await sendConfirmation(bookingId);
  return json({
    sent,
    message: sent ? 'Confirmation email sent.' : 'Email is not set up yet (RESEND_API_KEY / EMAIL_FROM), so nothing was sent.',
  });
});
