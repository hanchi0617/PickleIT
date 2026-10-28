// Runs the PickleIT migrations in PGlite with a minimal Supabase stub, then
// exercises the booking rules. Usage: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? new URL('../migrations', import.meta.url).pathname;
const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(dir, f), 'utf8'));
  console.log('migrated', f);
}
await db.exec(`grant execute on all functions in schema public to service_role;`);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

const OWNER = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-000000000002';
await db.exec(`
  insert into auth.users values ('${OWNER}', 'owner@x'), ('${STAFF}', 'staff@x');
  insert into public.staff values ('${OWNER}', 'Olive Owner', 'owner'), ('${STAFF}', 'Sam Staff', 'staff');
`);

async function as(role, uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    const r = await db.query(sql, params);
    return { rows: r.rows };
  } catch (e) {
    return { error: e };
  } finally {
    await db.exec('reset role;');
  }
}
const anon = (sql, p) => as('anon', null, sql, p);
const owner = (sql, p) => as('authenticated', OWNER, sql, p);
const staff = (sql, p) => as('authenticated', STAFF, sql, p);

const { rows: [{ d: day }] } = await db.query(
  `select ((now() at time zone 'Asia/Manila')::date + 3)::text as d`);
const { rows: [{ d: today }] } = await db.query(
  `select ((now() at time zone 'Asia/Manila')::date)::text as d`);
const { rows: [{ d: yesterday }] } = await db.query(
  `select ((now() at time zone 'Asia/Manila')::date - 1)::text as d`);
const guest = JSON.stringify({ name: 'Test Guest', phone: '0917 000 1111', email: 't@example.com' });
const slots = (arr) => JSON.stringify(arr.map(([c, h]) => ({ courtId: c, hour: h })));

// --- Guest flow ---
let r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb) as b`, [day, slots([['c1', 10], ['c1', 11]]), guest]);
ok('anon can create a hold', !r.error && r.rows[0].b.status === 'held', r.error?.message);
const hold = r.rows?.[0]?.b;
ok('hold priced from settings', hold?.amount === 1000, String(hold?.amount));
ok('reference format', /^PI-[A-Z2-9]{6}$/.test(hold?.reference ?? ''), hold?.reference);

r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb)`, [day, slots([['c1', 11]]), guest]);
ok('double booking rejected', r.error?.code === '23505', r.error?.message);

r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb)`, [day, slots([['c1', 23]]), guest]);
ok('outside opening hours rejected', /outside opening hours/.test(r.error?.message ?? ''), r.error?.message);

r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb)`, [yesterday, slots([['c2', 10]]), guest]);
ok('past hour rejected', /already passed/.test(r.error?.message ?? ''), r.error?.message);

r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb)`, [day, slots([['c9', 12]]), guest]);
ok('unknown court rejected', /court is not available/.test(r.error?.message ?? ''), r.error?.message);

r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb)`, [day, slots([['c2', 12]]), JSON.stringify({ name: 'X', phone: '', email: '' })]);
ok('bad guest details rejected', /name/.test(r.error?.message ?? ''), r.error?.message);

r = await anon(`select count(*)::int n from public.bookings`);
ok('anon cannot read bookings (RLS)', !r.error && r.rows[0].n === 0, r.error?.message ?? String(r.rows?.[0]?.n));

r = await anon(`select count(*)::int n from public.booking_slots where active`);
ok('anon can read taken slots', !r.error && r.rows[0].n === 2, r.error?.message ?? String(r.rows?.[0]?.n));

r = await anon(`select public.insert_slots(gen_random_uuid(), $1::date, $2::jsonb, 'booked', null)`, [day, slots([['c3', 9]])]);
ok('anon cannot call internal insert_slots', r.error?.code === '42501', r.error?.message);

r = await anon(`select public.confirm_payment($1::uuid)`, [hold.id]);
ok('anon cannot confirm payment directly', r.error?.code === '42501', r.error?.message);

r = await anon(`insert into public.bookings (reference, date, slots, guest_name, status, payment_status, source, amount)
  values ('PI-HACKED', $1::date, '[]', 'x', 'confirmed', 'paid', 'online', 0)`, [day]);
ok('anon cannot insert bookings directly', !!r.error, r.error?.message);

r = await anon(`select public.demo_confirm_payment($1::uuid, $2)`, [hold.id, 'PI-WRONG']);
ok('demo pay needs matching reference', !!r.error, r.error?.message);

r = await anon(`select public.demo_confirm_payment($1::uuid, $2) as b`, [hold.id, hold.reference]);
ok('demo pay confirms booking', r.rows?.[0]?.b?.status === 'confirmed' && r.rows[0].b.paymentStatus === 'paid', r.error?.message);

r = await anon(`select public.find_booking($1, $2) as b`, [hold.reference, 'T@EXAMPLE.com']);
ok('find booking by email', r.rows?.[0]?.b?.reference === hold.reference, r.error?.message);
ok('guest view has no contact details', r.rows?.[0]?.b && !('guest' in r.rows[0].b));
r = await anon(`select public.find_booking($1, $2) as b`, [hold.reference, '0917-000-1111']);
ok('find booking by phone', r.rows?.[0]?.b?.reference === hold.reference, r.error?.message);
r = await anon(`select public.find_booking($1, $2) as b`, [hold.reference, 'other@example.com']);
ok('wrong contact finds nothing', r.rows?.[0]?.b === null, JSON.stringify(r.rows?.[0]));

r = await anon(`select public.request_cancellation($1, $2, 'sick') as b`, [hold.reference, 't@example.com']);
ok('renter can request cancellation', r.rows?.[0]?.b?.cancelRequest?.status === 'pending', r.error?.message);

// --- Discounts ---
r = await staff(`select public.admin_save_discount('SAVE20', 'percent', 20, true, null, 1)`);
ok('staff cannot create discount', r.error?.code === '42501', r.error?.message);
r = await owner(`select public.admin_save_discount('save20', 'percent', 20, true, null, 1)`);
ok('owner creates discount', !r.error, r.error?.message);
r = await anon(`select public.check_discount('save20') as d`);
ok('discount check works', r.rows?.[0]?.d?.value === 20, JSON.stringify(r.rows?.[0]) + (r.error?.message ?? ''));
r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb, 'SAVE20') as b`, [day, slots([['c2', 15]]), guest]);
ok('discount applied to hold', r.rows?.[0]?.b?.amount === 400, r.error?.message ?? String(r.rows?.[0]?.b?.amount));
const h2 = r.rows?.[0]?.b;
await anon(`select public.demo_confirm_payment($1::uuid, $2)`, [h2.id, h2.reference]);
r = await anon(`select public.check_discount('SAVE20') as d`);
ok('single-use discount used up', r.rows?.[0]?.d === null, JSON.stringify(r.rows?.[0]));

// --- Hold expiry ---
r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb) as b`, [day, slots([['c3', 16]]), guest]);
await db.query(`update public.bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [r.rows[0].b.id]);
await db.query(`update public.booking_slots set hold_expires_at = now() - interval '1 minute' where booking_id = $1`, [r.rows[0].b.id]);
r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb) as b`, [day, slots([['c3', 16]]), guest]);
ok('expired hold frees the slot', r.rows?.[0]?.b?.status === 'held', r.error?.message);

// --- Staff ---
r = await anon(`select public.admin_create_booking($1::date, $2::jsonb, $3::jsonb, 'walk-in', true)`, [day, slots([['c2', 8]]), guest]);
ok('anon cannot use admin functions', !!r.error, r.error?.message);

r = await staff(`select public.admin_create_booking($1::date, $2::jsonb, $3::jsonb, 'walk-in', false) as b`, [day, slots([['c2', 8]]), guest]);
ok('staff creates walk-in booking', r.rows?.[0]?.b?.status === 'confirmed', r.error?.message);
const walk = r.rows?.[0]?.b;

r = await staff(`select count(*)::int n from public.bookings`);
ok('staff can read bookings', r.rows?.[0]?.n >= 4, r.error?.message ?? String(r.rows?.[0]?.n));

r = await staff(`select public.admin_set_attendance($1::uuid, 'checked-in')`, [walk.id]);
ok('cannot check in before the booking day', /day of the booking/.test(r.error?.message ?? ''), r.error?.message);

r = await staff(`select public.admin_reschedule($1::uuid, $2::date, $3::jsonb)`, [walk.id, day, slots([['c1', 10]])]);
ok('reschedule onto a taken slot rejected', r.error?.code === '23505', r.error?.message);
r = await staff(`select public.admin_reschedule($1::uuid, $2::date, $3::jsonb)`, [walk.id, day, slots([['c3', 8], ['c3', 9]])]);
ok('reschedule to free slots', !r.error, r.error?.message);
r = await db.query(`select amount::int a from public.bookings where id = $1`, [walk.id]);
ok('reschedule re-prices', r.rows[0].a === 1000, String(r.rows[0].a));

r = await staff(`select public.admin_cancel($1::uuid, false, false, 'x')`, [walk.id]);
ok('cancel requires renter confirmation', /Confirm with the renter/.test(r.error?.message ?? ''), r.error?.message);
r = await staff(`select public.admin_cancel($1::uuid, true, true, 'x')`, [walk.id]);
ok('staff cannot refund', /Only the owner/.test(r.error?.message ?? ''), r.error?.message);
r = await staff(`select public.admin_cancel($1::uuid, true, false, 'renter called')`, [walk.id]);
ok('staff cancels after renter confirmed', !r.error, r.error?.message);
r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb) as b`, [day, slots([['c3', 8]]), guest]);
ok('cancelled booking frees its slots', r.rows?.[0]?.b?.status === 'held', r.error?.message);

r = await owner(`select public.admin_resolve_cancel_request($1::uuid, true, true)`, [hold.id]);
ok('owner approves request with refund', !r.error, r.error?.message);
r = await db.query(`select status, payment_status, cancel_request_status from public.bookings where id = $1`, [hold.id]);
ok('request approval cancels + refunds', r.rows[0].status === 'cancelled' && r.rows[0].payment_status === 'refunded' && r.rows[0].cancel_request_status === 'approved', JSON.stringify(r.rows[0]));

// Today: attendance works for a past hour booked by staff.
r = await owner(`select public.admin_create_booking($1::date, $2::jsonb, $3::jsonb, 'phone', true) as b`, [yesterday, slots([['c1', 6]]), guest]);
ok('staff can record an earlier booking', !r.error, r.error?.message);
if (!r.error) {
  const t = r.rows[0].b;
  r = await staff(`select public.admin_set_attendance($1::uuid, 'no-show')`, [t.id]);
  ok('mark no-show after the day', !r.error, r.error?.message);
  r = await staff(`select public.admin_set_attendance($1::uuid, 'checked-in')`, [t.id]);
  ok('check in after the day', !r.error, r.error?.message);
}

r = await staff(`select public.admin_add_block($1::date, 'all', 12, 14, 'Tournament')`, [day]);
ok('staff adds closure', !r.error, r.error?.message);
r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb)`, [day, slots([['c2', 13]]), guest]);
ok('closure blocks booking', r.error?.code === '23505', r.error?.message);

r = await staff(`select public.admin_update_settings('{}'::jsonb)`);
ok('staff cannot change settings', r.error?.code === '42501', r.error?.message);
const { rows: [{ data: cur }] } = await db.query(`select data from public.settings`);
r = await owner(`select public.admin_update_settings($1::jsonb)`, [JSON.stringify({ ...cur, holdMinutes: 15 })]);
ok('owner can change settings', r.error?.code === '42501' ? false : !r.error, r.error?.message);

r = await staff(`select count(*)::int n from public.audit_log`);
ok('audit log records actions', r.rows?.[0]?.n >= 8, r.error?.message ?? String(r.rows?.[0]?.n));
r = await anon(`select count(*)::int n from public.audit_log`);
ok('anon cannot read audit log', r.rows?.[0]?.n === 0, r.error?.message);

r = await anon(`select public.join_waitlist($1::date, null, 18, $2::jsonb)`, [day, guest]);
ok('anon can join waitlist', !r.error, r.error?.message);
r = await anon(`select count(*)::int n from public.waitlist`);
ok('anon cannot read waitlist', r.rows?.[0]?.n === 0, r.error?.message);

r = await db.query(`select count(*)::int n from public.due_reminders()`);
ok('due_reminders runs', r.rows[0].n >= 0);

await db.query(`update public.app_config set demo_payments = false`);
r = await anon(`select public.create_hold($1::date, $2::jsonb, $3::jsonb) as b`, [day, slots([['c1', 19]]), guest]);
r = await anon(`select public.demo_confirm_payment($1::uuid, $2)`, [r.rows[0].b.id, r.rows[0].b.reference]);
ok('demo payments can be switched off', /disabled/.test(r.error?.message ?? ''), r.error?.message);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
