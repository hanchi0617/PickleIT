// Receives PayMongo webhooks and confirms paid bookings. This is the ONLY
// place a booking becomes "paid" for online payments.
//
// Secrets: PAYMONGO_WEBHOOK_SECRET (from the PayMongo dashboard).
// Deploy with --no-verify-jwt, since PayMongo doesn't send a Supabase token.
//
// NOT YET TESTED against PayMongo: verify the event shape and signature
// format against their current docs before going live.
import { adminClient, json, sendConfirmation } from '../_shared/common.ts';

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET');
  if (!secret) return json({ error: 'Webhook secret not configured' }, 500);

  const raw = await req.text();
  // Header looks like: t=1700000000,te=<test signature>,li=<live signature>
  const header = Object.fromEntries(
    (req.headers.get('Paymongo-Signature') ?? '').split(',').map((p) => p.split('=') as [string, string]),
  );
  const expected = await hmacHex(secret, `${header.t}.${raw}`);
  const given = header.li || header.te || '';
  if (!header.t || !safeEqual(expected, given)) return json({ error: 'Bad signature' }, 401);

  const event = JSON.parse(raw);
  const type: string = event?.data?.attributes?.type;
  if (type !== 'checkout_session.payment.paid') return json({ ignored: type });

  const session = event.data.attributes.data;
  const bookingId: string | undefined = session?.attributes?.metadata?.booking_id;
  const paymentId: string | undefined = session?.attributes?.payments?.[0]?.id ?? session?.id;
  if (!bookingId) return json({ error: 'No booking id in metadata' }, 400);

  const { error } = await adminClient().rpc('confirm_payment', { p_id: bookingId, p_payment_ref: paymentId });
  if (error) {
    console.error('confirm_payment failed', error);
    return json({ error: error.message }, 500); // PayMongo retries on failure
  }
  await sendConfirmation(bookingId).catch((e) => console.error('confirmation email failed', e));
  return json({ ok: true });
});
