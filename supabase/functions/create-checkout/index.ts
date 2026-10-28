// Starts payment for a held booking.
//
// With a PAYMONGO_SECRET_KEY secret set, creates a PayMongo checkout session
// (GCash, Maya, cards) and returns its URL. Without one, returns
// { demo: true } so the site shows the demo pay button instead.
//
// NOT YET TESTED against PayMongo: check the request against their current
// docs (https://developers.paymongo.com) and use test keys first.
import { adminClient, cors, json } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { bookingId, reference, returnUrl } = await req.json().catch(() => ({}));
  const secret = Deno.env.get('PAYMONGO_SECRET_KEY');
  if (!secret) return json({ demo: true });

  const db = adminClient();
  const { data: b } = await db.from('bookings').select('*').eq('id', bookingId).eq('reference', reference).single();
  if (!b || b.status !== 'held') return json({ error: 'This booking is no longer waiting for payment.' }, 400);

  const site = Deno.env.get('SITE_URL') ?? returnUrl ?? '';
  const res = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${secret}:`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              name: `Court booking ${b.reference}`,
              amount: Math.round(Number(b.amount) * 100), // centavos
              currency: 'PHP',
              quantity: 1,
            },
          ],
          payment_method_types: ['gcash', 'paymaya', 'card'],
          reference_number: b.reference,
          description: `Court booking ${b.reference}`,
          billing: { name: b.guest_name, email: b.guest_email, phone: b.guest_phone },
          success_url: `${site}/book?paid=${b.reference}`,
          cancel_url: `${site}/book?cancelled=${b.reference}`,
          metadata: { booking_id: b.id },
        },
      },
    }),
  });

  if (!res.ok) {
    console.error('PayMongo error', res.status, await res.text());
    return json({ error: 'Could not start payment. Please try again.' }, 502);
  }
  const out = await res.json();
  return json({ url: out.data.attributes.checkout_url, demo: false });
});
