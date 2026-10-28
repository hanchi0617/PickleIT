# PickleIT backend (Supabase)

Until this is set up, the site runs in **demo mode**: everything works, but
data is stored only in each visitor's browser. Follow these steps to switch to
the real, shared database.

## What's here

| Path | What it does |
|---|---|
| `migrations/…_booking_schema.sql` | Tables, security rules and all booking functions |
| `migrations/…_default_settings.sql` | Starting courts, prices and hours |
| `functions/create-checkout` | Starts a PayMongo payment (falls back to demo pay) |
| `functions/payment-webhook` | Confirms bookings when PayMongo reports payment |
| `functions/send-reminders` | Emails reminders before bookings (run hourly) |
| `functions/resend-confirmation` | Staff "Resend confirmation" button |
| `tests/schema.test.mjs` | 52 checks of the rules, run with `npm run test:db` |

The rules are enforced by the database, not the browser: no double-booking
(a unique index), staff-only access to contact details (row level security),
owner-only refunds, settings and discounts, and payments that only the webhook
can confirm.

## 1. Create the project

1. Sign up at https://supabase.com and create a project.
2. Install the CLI (`brew install supabase/tap/supabase`), then in this folder:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. Copy `.env.example` to `.env` and fill in the URL and anon key from
   Project Settings → API. Restart `npm run dev`. The admin's demo banner disappears.

## 2. Add staff

1. Authentication → Users → Add user (email + password) for each person.
2. SQL editor, once per person:
   ```sql
   insert into staff (user_id, name, role)
   values ('<user id from step 1>', 'Their name', 'owner');  -- or 'staff'
   ```
   Owners can change settings, prices and discount codes and give refunds.
   Staff can manage bookings, check-in, no-shows and closures.

## 3. Payments (PayMongo)

1. Get test keys at https://dashboard.paymongo.com.
2. ```bash
   supabase secrets set PAYMONGO_SECRET_KEY=sk_test_... SITE_URL=https://your-site
   supabase functions deploy create-checkout
   supabase functions deploy payment-webhook --no-verify-jwt
   ```
3. In PayMongo, add a webhook to
   `https://<project-ref>.supabase.co/functions/v1/payment-webhook` for the
   `checkout_session.payment.paid` event, then
   `supabase secrets set PAYMONGO_WEBHOOK_SECRET=whsk_...`.
4. Test a booking end to end with test cards / test GCash.
5. **Before launch**, turn off the demo pay button:
   ```sql
   update app_config set demo_payments = false;
   ```

The PayMongo request and webhook code follow their documented API but have not
been run against a live account yet. Check them in test mode first.

## 4. Emails and reminders (Resend)

1. Create an account at https://resend.com and verify your domain.
2. ```bash
   supabase secrets set RESEND_API_KEY=re_... EMAIL_FROM="PickleIT <bookings@yourdomain.com>"
   supabase functions deploy send-reminders
   supabase functions deploy resend-confirmation
   ```
3. Run reminders every hour. In the dashboard enable the `pg_cron` and
   `pg_net` extensions, then in the SQL editor:
   ```sql
   select cron.schedule('expire-holds', '* * * * *', 'select public.expire_holds()');
   select cron.schedule('send-reminders', '0 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <service role key>')
     );
   $$);
   ```

Email wording is edited in Admin → Settings → Reminders and emails.
