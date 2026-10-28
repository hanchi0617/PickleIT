-- PickleIT booking schema.
--
-- Security model:
--  * The public can read settings, closures and which slots are taken
--    (booking_slots), but never anyone's name, phone or email.
--  * Guests only change data through the guest functions below (create_hold,
--    request_cancellation, ...), which validate everything server-side.
--  * Staff (rows in public.staff) manage bookings through admin_* functions,
--    which check the caller's role and write an audit log entry.
--  * Payments are confirmed only by confirm_payment(), which only the
--    payment webhook (service role) can call.
--  * Double-booking is impossible: a unique index allows one active booking
--    per court, date and hour.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Server-only switches. Not readable by the public.
create table public.app_config (
  id int primary key default 1 check (id = 1),
  -- Lets the "Pay (demo)" button confirm bookings without a payment
  -- provider. MUST be set to false before launch.
  demo_payments boolean not null default true
);
insert into public.app_config default values;

create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  date date not null,
  slots jsonb not null,
  guest_name text not null,
  guest_phone text not null default '',
  guest_email text not null default '',
  status text not null check (status in ('held', 'confirmed', 'cancelled', 'expired')),
  payment_status text not null check (payment_status in ('pending', 'paid', 'unpaid', 'refunded')),
  source text not null check (source in ('online', 'walk-in', 'phone', 'recurring')),
  amount numeric(10, 2) not null check (amount >= 0),
  discount_code text,
  discount_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now(),
  hold_expires_at timestamptz,
  notes text,
  attendance text not null default 'pending' check (attendance in ('pending', 'checked-in', 'no-show')),
  checked_in_at timestamptz,
  cancel_request_status text check (cancel_request_status in ('pending', 'approved', 'declined')),
  cancel_request_reason text,
  cancel_requested_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  renter_confirmed_cancel boolean,
  series_id uuid,
  payment_ref text,
  confirmation_sent_at timestamptz,
  reminder_sent_at timestamptz
);
create index bookings_date_idx on public.bookings (date);
create index bookings_hold_idx on public.bookings (hold_expires_at) where status = 'held';

-- One row per booked court-hour. Public, but holds no personal details.
create table public.booking_slots (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  date date not null,
  court_id text not null,
  hour int not null check (hour between 0 and 23),
  kind text not null check (kind in ('held', 'booked')),
  hold_expires_at timestamptz,
  active boolean not null default true,
  primary key (booking_id, court_id, hour)
);
-- The double-booking guard.
create unique index booking_slots_one_per_hour on public.booking_slots (court_id, date, hour) where active;
create index booking_slots_date_idx on public.booking_slots (date) where active;

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  court_id text not null,
  start_hour int not null,
  end_hour int not null check (end_hour > start_hour),
  reason text not null,
  created_at timestamptz not null default now()
);
create index blocks_date_idx on public.blocks (date);

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  court_id text,
  hour int not null,
  guest_name text not null,
  guest_phone text not null default '',
  guest_email text not null default '',
  status text not null default 'waiting' check (status in ('waiting', 'contacted', 'booked', 'removed')),
  created_at timestamptz not null default now()
);

create table public.discount_codes (
  code text primary key check (code = upper(code) and code ~ '^[A-Z0-9-]{3,20}$'),
  kind text not null check (kind in ('percent', 'fixed')),
  value numeric(10, 2) not null check (value > 0),
  active boolean not null default true,
  expires_on date,
  max_uses int check (max_uses > 0),
  uses int not null default 0,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);

create table public.customer_notes (
  key text primary key,
  notes text not null default '',
  flagged boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  detail text not null default '',
  reference text
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.settings enable row level security;
alter table public.app_config enable row level security;
alter table public.staff enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_slots enable row level security;
alter table public.blocks enable row level security;
alter table public.waitlist enable row level security;
alter table public.discount_codes enable row level security;
alter table public.customer_notes enable row level security;
alter table public.audit_log enable row level security;

-- Helpers used by policies and functions.
create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid());
$$;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where user_id = auth.uid() and role = 'owner');
$$;

create policy "settings are public" on public.settings for select using (true);
create policy "taken slots are public" on public.booking_slots for select using (true);
create policy "closures are public" on public.blocks for select using (true);

create policy "staff see staff" on public.staff for select using (public.is_staff());
create policy "staff see bookings" on public.bookings for select using (public.is_staff());
create policy "staff see waitlist" on public.waitlist for select using (public.is_staff());
create policy "staff update waitlist" on public.waitlist for update using (public.is_staff()) with check (public.is_staff());
create policy "staff see discounts" on public.discount_codes for select using (public.is_staff());
create policy "staff manage notes" on public.customer_notes for all using (public.is_staff()) with check (public.is_staff());
create policy "staff see audit log" on public.audit_log for select using (public.is_staff());
-- No other policies: every other write goes through the functions below.

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by the public)
-- ---------------------------------------------------------------------------

create function public.settings_data() returns jsonb
language sql stable security definer set search_path = public as $$
  select data from settings where id = 1;
$$;

create function public.venue_now() returns timestamp
language sql stable security definer set search_path = public as $$
  select now() at time zone (settings_data() ->> 'timezone');
$$;

create function public.staff_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from staff where user_id = auth.uid()), 'System');
$$;

create function public.log_action(p_action text, p_detail text default '', p_reference text default null, p_actor text default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor, action, detail, reference)
  values (coalesce(p_actor, staff_name()), p_action, coalesce(p_detail, ''), p_reference);
$$;

create function public.require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Please sign in as staff.' using errcode = '42501'; end if;
end $$;

create function public.require_owner() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner can do that.' using errcode = '42501'; end if;
end $$;

create function public.expire_holds() returns void
language plpgsql security definer set search_path = public as $$
begin
  update booking_slots set active = false
   where active and kind = 'held' and hold_expires_at <= now();
  update bookings set status = 'expired', payment_status = 'unpaid', hold_expires_at = null
   where status = 'held' and hold_expires_at <= now();
end $$;

create function public.slot_price(s jsonb, p_court text, p_date date, p_hour int) returns numeric
language sql immutable as $$
  select case
    when (s -> 'peak' ->> 'enabled')::boolean
     and (s -> 'peak' -> 'days') @> to_jsonb(extract(dow from p_date)::int)
     and p_hour >= (s -> 'peak' ->> 'startHour')::int
     and p_hour < (s -> 'peak' ->> 'endHour')::int
    then (s -> 'peak' ->> 'pricePerHour')::numeric
    else coalesce((select (c ->> 'pricePerHour')::numeric
                     from jsonb_array_elements(s -> 'courts') c
                    where c ->> 'id' = p_court), 0)
  end;
$$;

create function public.price_slots(p_date date, p_slots jsonb) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(slot_price(settings_data(), x ->> 'courtId', p_date, (x ->> 'hour')::int)), 0)
    from jsonb_array_elements(p_slots) x;
$$;

-- Raises a readable error if the slots can't be booked.
create function public.validate_slots(p_date date, p_slots jsonb, p_allow_past boolean)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  s jsonb := settings_data();
  local_now timestamp := venue_now();
  day jsonb := s -> 'hours' -> extract(dow from p_date)::int;
  sl jsonb;
  court jsonb;
  h int;
begin
  if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Pick at least one hour.';
  end if;
  if jsonb_array_length(p_slots) > 48 then raise exception 'Too many hours selected.'; end if;
  if (day ->> 'closed')::boolean
     or exists (select 1 from jsonb_array_elements(s -> 'holidays') x where (x ->> 'date')::date = p_date) then
    raise exception 'The venue is closed that day.';
  end if;
  if not p_allow_past and p_date > local_now::date + (s ->> 'maxDaysAhead')::int then
    raise exception 'That date is too far ahead.';
  end if;
  if (select count(*) from jsonb_array_elements(p_slots))
     <> (select count(distinct (x ->> 'courtId', x ->> 'hour')) from jsonb_array_elements(p_slots) x) then
    raise exception 'Duplicate hour selected.';
  end if;

  for sl in select * from jsonb_array_elements(p_slots) loop
    h := (sl ->> 'hour')::int;
    select c into court from jsonb_array_elements(s -> 'courts') c where c ->> 'id' = sl ->> 'courtId';
    if court is null or not (court ->> 'active')::boolean then
      raise exception 'That court is not available.';
    end if;
    if h is null or h < (day ->> 'open')::int or h >= (day ->> 'close')::int then
      raise exception 'That time is outside opening hours.';
    end if;
    if not p_allow_past and p_date + make_interval(hours => h) <= local_now then
      raise exception 'That time has already passed.';
    end if;
  end loop;
end $$;

create function public.check_blocks(p_date date, p_slots jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (
    select 1 from blocks b, jsonb_array_elements(p_slots) x
     where b.date = p_date
       and (b.court_id = 'all' or b.court_id = x ->> 'courtId')
       and (x ->> 'hour')::int >= b.start_hour and (x ->> 'hour')::int < b.end_hour
  ) then
    raise exception 'SLOT_TAKEN' using errcode = '23505';
  end if;
end $$;

create function public.insert_slots(p_booking uuid, p_date date, p_slots jsonb, p_kind text, p_expires timestamptz)
returns void language sql security definer set search_path = public as $$
  insert into booking_slots (booking_id, date, court_id, hour, kind, hold_expires_at)
  select p_booking, p_date, x ->> 'courtId', (x ->> 'hour')::int, p_kind, p_expires
    from jsonb_array_elements(p_slots) x;
$$;

create function public.make_reference() returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  r text;
begin
  loop
    r := 'PI-';
    for i in 1..6 loop
      r := r || substr(chars, 1 + floor(random() * 32)::int, 1);
    end loop;
    exit when not exists (select 1 from bookings where reference = r);
  end loop;
  return r;
end $$;

create function public.ms(t timestamptz) returns bigint
language sql immutable as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- Full booking as the admin sees it (matches the Booking type in TypeScript).
create function public.booking_json(b public.bookings) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'reference', b.reference, 'date', b.date, 'slots', b.slots,
    'guest', jsonb_build_object('name', b.guest_name, 'phone', b.guest_phone, 'email', b.guest_email),
    'status', b.status, 'paymentStatus', b.payment_status, 'source', b.source, 'amount', b.amount,
    'discountCode', b.discount_code, 'discountAmount', nullif(b.discount_amount, 0),
    'createdAt', ms(b.created_at), 'holdExpiresAt', ms(b.hold_expires_at),
    'notes', b.notes, 'attendance', b.attendance, 'checkedInAt', ms(b.checked_in_at),
    'cancelRequest', case when b.cancel_request_status is null then null else jsonb_build_object(
      'status', b.cancel_request_status, 'reason', b.cancel_request_reason, 'at', ms(b.cancel_requested_at)) end,
    'cancelledAt', ms(b.cancelled_at), 'cancelReason', b.cancel_reason,
    'renterConfirmedCancel', b.renter_confirmed_cancel, 'seriesId', b.series_id
  ));
$$;

-- What a renter sees about their own booking (matches GuestBooking).
create function public.guest_json(b public.bookings) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'reference', b.reference, 'date', b.date, 'slots', b.slots,
    'status', b.status, 'paymentStatus', b.payment_status, 'amount', b.amount,
    'attendance', b.attendance, 'guestName', b.guest_name,
    'cancelRequest', case when b.cancel_request_status is null then null else jsonb_build_object(
      'status', b.cancel_request_status, 'reason', b.cancel_request_reason, 'at', ms(b.cancel_requested_at)) end
  ));
$$;

create function public.contact_matches(b public.bookings, p_contact text) returns boolean
language sql immutable as $$
  select case
    when position('@' in p_contact) > 0 then lower(trim(b.guest_email)) = lower(trim(p_contact))
    else length(regexp_replace(p_contact, '\D', '', 'g')) >= 7
     and regexp_replace(b.guest_phone, '\D', '', 'g') = regexp_replace(p_contact, '\D', '', 'g')
  end;
$$;

create function public.valid_discount(p_code text) returns public.discount_codes
language sql stable security definer set search_path = public as $$
  select d.* from discount_codes d
   where d.code = upper(trim(p_code)) and d.active
     and (d.expires_on is null or d.expires_on >= venue_now()::date)
     and (d.max_uses is null or d.uses < d.max_uses);
$$;

-- ---------------------------------------------------------------------------
-- Guest functions
-- ---------------------------------------------------------------------------

create function public.check_discount(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when d.code is null then null
              else jsonb_build_object('code', d.code, 'kind', d.kind, 'value', d.value) end
    from valid_discount(p_code) d;
$$;

create function public.create_hold(p_date date, p_slots jsonb, p_guest jsonb, p_discount text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_name text := trim(coalesce(p_guest ->> 'name', ''));
  v_phone text := trim(coalesce(p_guest ->> 'phone', ''));
  v_email text := trim(coalesce(p_guest ->> 'email', ''));
  subtotal numeric;
  disc numeric := 0;
  d discount_codes;
  b bookings;
begin
  if length(v_name) < 2 then raise exception 'Please enter your name.'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then raise exception 'Please enter a valid mobile number.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please enter a valid email.'; end if;

  perform expire_holds();
  perform validate_slots(p_date, p_slots, false);
  perform check_blocks(p_date, p_slots);

  subtotal := price_slots(p_date, p_slots);
  if nullif(trim(p_discount), '') is not null then
    d := valid_discount(p_discount);
    if d.code is null then raise exception 'That discount code is not valid.'; end if;
    disc := case when d.kind = 'percent' then round(subtotal * d.value / 100, 2) else least(d.value, subtotal) end;
  end if;

  insert into bookings (reference, date, slots, guest_name, guest_phone, guest_email, status,
                        payment_status, source, amount, discount_code, discount_amount, hold_expires_at)
  values (make_reference(), p_date, p_slots, v_name, v_phone, v_email, 'held', 'pending', 'online',
          subtotal - disc, d.code, disc,
          now() + make_interval(mins => (settings_data() ->> 'holdMinutes')::int))
  returning * into b;

  -- Fails with a unique violation if any hour was taken meanwhile.
  perform insert_slots(b.id, p_date, p_slots, 'held', b.hold_expires_at);
  return booking_json(b);
end $$;

create function public.release_hold(p_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update booking_slots set active = false where booking_id = p_id and kind = 'held'
     and exists (select 1 from bookings where id = p_id and reference = p_reference and status = 'held');
  update bookings set status = 'expired', payment_status = 'unpaid', hold_expires_at = null
   where id = p_id and reference = p_reference and status = 'held';
end $$;

-- Called ONLY by the payment webhook (service role) once payment succeeds.
create function public.confirm_payment(p_id uuid, p_payment_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if b.status = 'confirmed' then return booking_json(b); end if;

  if b.status = 'held' then
    update booking_slots set kind = 'booked', hold_expires_at = null where booking_id = p_id;
  elsif b.status = 'expired' then
    -- Paid after the hold ran out: re-take the slots if they are still free.
    begin
      update booking_slots set active = true, kind = 'booked', hold_expires_at = null where booking_id = p_id;
    exception when unique_violation then
      update bookings set payment_status = 'paid', payment_ref = p_payment_ref, status = 'cancelled',
             cancelled_at = now(), cancel_reason = 'Paid after the hold expired and the slot was taken. Refund needed.'
       where id = p_id returning * into b;
      perform log_action('Payment after expiry, refund needed', '', b.reference, 'Payment provider');
      return booking_json(b);
    end;
  else
    raise exception 'This booking can no longer be paid.';
  end if;

  update bookings set status = 'confirmed', payment_status = 'paid', hold_expires_at = null, payment_ref = p_payment_ref
   where id = p_id returning * into b;
  if b.discount_code is not null then
    update discount_codes set uses = uses + 1 where code = b.discount_code;
  end if;
  perform log_action('Booked online', '', b.reference, 'Guest');
  return booking_json(b);
end $$;

-- Stand-in for a payment provider while testing. Refuses once
-- app_config.demo_payments is switched off.
create function public.demo_confirm_payment(p_id uuid, p_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (select demo_payments from app_config where id = 1) then
    raise exception 'Demo payments are disabled.';
  end if;
  if not exists (select 1 from bookings where id = p_id and reference = p_reference and status = 'held') then
    perform expire_holds();
    raise exception 'Your hold expired before payment finished. Please pick your slot again.';
  end if;
  return confirm_payment(p_id, 'demo');
end $$;

create function public.find_booking(p_reference text, p_contact text)
returns jsonb language sql stable security definer set search_path = public as $$
  select guest_json(b) from bookings b
   where b.reference = upper(trim(p_reference)) and contact_matches(b, p_contact);
$$;

create function public.request_cancellation(p_reference text, p_contact text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s jsonb := settings_data();
  b bookings;
  starts timestamp;
begin
  select * into b from bookings
   where reference = upper(trim(p_reference)) and contact_matches(bookings, p_contact) for update;
  if not found then raise exception 'Booking not found.'; end if;
  if not (s -> 'cancellation' ->> 'allowRequests')::boolean then
    raise exception 'Online cancellation requests are turned off. Please contact the venue.';
  end if;
  if b.status <> 'confirmed' then raise exception 'Only confirmed bookings can be cancelled.'; end if;
  if b.cancel_request_status = 'pending' then
    raise exception 'A cancellation request is already waiting for the venue to confirm.';
  end if;
  starts := b.date + make_interval(hours => (select min((x ->> 'hour')::int) from jsonb_array_elements(b.slots) x));
  if starts - venue_now() < make_interval(hours => (s -> 'cancellation' ->> 'minHoursBefore')::int) then
    raise exception 'Cancellations must be requested at least % hours before your booking. Please contact the venue.',
      s -> 'cancellation' ->> 'minHoursBefore';
  end if;

  update bookings set cancel_request_status = 'pending',
         cancel_request_reason = coalesce(nullif(trim(p_reason), ''), 'No reason given'),
         cancel_requested_at = now()
   where id = b.id returning * into b;
  perform log_action('Requested cancellation', b.cancel_request_reason, b.reference, 'Guest');
  return guest_json(b);
end $$;

create function public.join_waitlist(p_date date, p_court text, p_hour int, p_guest jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_guest ->> 'name', ''))) < 2 then raise exception 'Please enter your name.'; end if;
  if p_date < venue_now()::date then raise exception 'That date has passed.'; end if;
  if (select count(*) from waitlist where created_at > now() - interval '1 hour') > 200 then
    raise exception 'Too many requests, please try again later.';
  end if;
  insert into waitlist (date, court_id, hour, guest_name, guest_phone, guest_email)
  values (p_date, p_court, p_hour, trim(p_guest ->> 'name'),
          trim(coalesce(p_guest ->> 'phone', '')), trim(coalesce(p_guest ->> 'email', '')));
end $$;

-- ---------------------------------------------------------------------------
-- Staff functions
-- ---------------------------------------------------------------------------

create function public.admin_create_booking(p_date date, p_slots jsonb, p_guest jsonb, p_source text,
                                            p_paid boolean, p_notes text default null, p_series uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  perform require_staff();
  if length(trim(coalesce(p_guest ->> 'name', ''))) < 2 then raise exception 'Enter the guest name.'; end if;
  perform expire_holds();
  perform validate_slots(p_date, p_slots, true);
  perform check_blocks(p_date, p_slots);
  insert into bookings (reference, date, slots, guest_name, guest_phone, guest_email, status, payment_status,
                        source, amount, notes, series_id)
  values (make_reference(), p_date, p_slots, trim(p_guest ->> 'name'), trim(coalesce(p_guest ->> 'phone', '')),
          trim(coalesce(p_guest ->> 'email', '')), 'confirmed', case when p_paid then 'paid' else 'unpaid' end,
          p_source, price_slots(p_date, p_slots), nullif(trim(p_notes), ''), p_series)
  returning * into b;
  perform insert_slots(b.id, p_date, p_slots, 'booked', null);
  perform log_action('Booking created', p_source, b.reference);
  return booking_json(b);
end $$;

create function public.admin_update_booking(p_id uuid, p_guest jsonb, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ref text;
begin
  perform require_staff();
  if length(trim(coalesce(p_guest ->> 'name', ''))) < 2 then raise exception 'Enter the guest name.'; end if;
  update bookings set guest_name = trim(p_guest ->> 'name'), guest_phone = trim(coalesce(p_guest ->> 'phone', '')),
         guest_email = trim(coalesce(p_guest ->> 'email', '')), notes = nullif(trim(p_notes), '')
   where id = p_id returning reference into ref;
  if ref is null then raise exception 'Booking not found.'; end if;
  perform log_action('Booking edited', 'Guest details or notes', ref);
end $$;

create function public.admin_reschedule(p_id uuid, p_date date, p_slots jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  perform require_staff();
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if b.status <> 'confirmed' then raise exception 'Only confirmed bookings can be moved.'; end if;
  perform expire_holds();
  perform validate_slots(p_date, p_slots, false);
  perform check_blocks(p_date, p_slots);
  delete from booking_slots where booking_id = p_id;
  perform insert_slots(p_id, p_date, p_slots, 'booked', null);
  update bookings set date = p_date, slots = p_slots,
         amount = greatest(price_slots(p_date, p_slots) - discount_amount, 0)
   where id = p_id;
  perform log_action('Rescheduled', b.date || ' → ' || p_date, b.reference);
end $$;

create function public.cancel_internal(p_id uuid, p_refund boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if b.status not in ('confirmed', 'held') then raise exception 'This booking is not active.'; end if;
  update booking_slots set active = false where booking_id = p_id;
  update bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
         renter_confirmed_cancel = true, hold_expires_at = null,
         cancel_request_status = case when cancel_request_status = 'pending' then 'approved' else cancel_request_status end,
         payment_status = case when payment_status = 'paid' and p_refund then 'refunded'
                               when payment_status = 'pending' then 'unpaid' else payment_status end
   where id = p_id;
  perform log_action(case when p_refund then 'Cancelled and refunded' else 'Cancelled' end, p_reason, b.reference);
end $$;

create function public.admin_cancel(p_id uuid, p_renter_confirmed boolean, p_refund boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  if not p_renter_confirmed then raise exception 'Confirm with the renter before cancelling.'; end if;
  if p_refund then perform require_owner(); end if;
  perform cancel_internal(p_id, p_refund, coalesce(nullif(trim(p_reason), ''), 'Cancelled by venue'));
end $$;

create function public.admin_resolve_cancel_request(p_id uuid, p_approve boolean, p_refund boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  perform require_staff();
  if p_refund then perform require_owner(); end if;
  select * into b from bookings where id = p_id;
  if b.cancel_request_status is distinct from 'pending' then raise exception 'There is no pending request.'; end if;
  if p_approve then
    perform cancel_internal(p_id, p_refund, 'Renter''s request: ' || b.cancel_request_reason);
  else
    update bookings set cancel_request_status = 'declined' where id = p_id;
    perform log_action('Declined cancellation request', '', b.reference);
  end if;
end $$;

create function public.admin_set_attendance(p_id uuid, p_attendance text)
returns void language plpgsql security definer set search_path = public as $$
declare
  b bookings;
begin
  perform require_staff();
  if p_attendance not in ('pending', 'checked-in', 'no-show') then raise exception 'Invalid attendance.'; end if;
  select * into b from bookings where id = p_id for update;
  if not found then raise exception 'Booking not found.'; end if;
  if b.status <> 'confirmed' then raise exception 'Only confirmed bookings can be checked in.'; end if;
  if b.date > venue_now()::date then raise exception 'You can only check in on the day of the booking.'; end if;
  update bookings set attendance = p_attendance,
         checked_in_at = case when p_attendance = 'checked-in' then now() else null end
   where id = p_id;
  perform log_action(case p_attendance when 'checked-in' then 'Checked in' when 'no-show' then 'Marked no-show'
                                       else 'Attendance reset' end, b.guest_name, b.reference);
end $$;

create function public.admin_mark_paid(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  ref text;
begin
  perform require_staff();
  update bookings set payment_status = 'paid' where id = p_id returning reference into ref;
  if ref is null then raise exception 'Booking not found.'; end if;
  perform log_action('Marked as paid', '', ref);
end $$;

create function public.admin_add_block(p_date date, p_court text, p_start int, p_end int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_staff();
  if nullif(trim(p_reason), '') is null then raise exception 'Add a reason.'; end if;
  if p_end <= p_start then raise exception 'End time must be after start time.'; end if;
  insert into blocks (date, court_id, start_hour, end_hour, reason) values (p_date, p_court, p_start, p_end, trim(p_reason));
  perform log_action('Closed off time', p_date || ' · ' || trim(p_reason));
end $$;

create function public.admin_remove_block(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  bl blocks;
begin
  perform require_staff();
  delete from blocks where id = p_id returning * into bl;
  if bl.id is not null then perform log_action('Removed closure', bl.date || ' · ' || bl.reason); end if;
end $$;

create function public.admin_update_settings(p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  if jsonb_typeof(p_data -> 'courts') <> 'array' or jsonb_array_length(p_data -> 'courts') = 0 then
    raise exception 'Add at least one court.';
  end if;
  if jsonb_array_length(p_data -> 'hours') <> 7 then raise exception 'Opening hours need all seven days.'; end if;
  update settings set data = p_data, updated_at = now() where id = 1;
  perform log_action('Settings updated');
end $$;

create function public.admin_save_discount(p_code text, p_kind text, p_value numeric, p_active boolean,
                                           p_expires date, p_max_uses int)
returns void language plpgsql security definer set search_path = public as $$
declare
  existed boolean;
begin
  perform require_owner();
  select exists (select 1 from discount_codes where code = upper(trim(p_code))) into existed;
  insert into discount_codes (code, kind, value, active, expires_on, max_uses)
  values (upper(trim(p_code)), p_kind, p_value, p_active, p_expires, p_max_uses)
  on conflict (code) do update set kind = excluded.kind, value = excluded.value, active = excluded.active,
     expires_on = excluded.expires_on, max_uses = excluded.max_uses;
  perform log_action(case when existed then 'Discount updated' else 'Discount created' end, upper(trim(p_code)));
end $$;

create function public.admin_delete_discount(p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_owner();
  delete from discount_codes where code = p_code;
  perform log_action('Discount deleted', p_code);
end $$;

-- Bookings due a reminder email (used by the send-reminders edge function).
create function public.due_reminders()
returns setof public.bookings language sql stable security definer set search_path = public as $$
  select b.* from bookings b
   where b.status = 'confirmed' and b.reminder_sent_at is null
     and (b.date + make_interval(hours => (select min((x ->> 'hour')::int) from jsonb_array_elements(b.slots) x)))
         between venue_now()
             and venue_now() + make_interval(hours => (settings_data() -> 'reminders' ->> 'hoursBefore')::int);
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

-- Functions are executable by everyone by default; lock down the internal ones.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_staff(), public.is_owner(),
  public.check_discount(text),
  public.create_hold(date, jsonb, jsonb, text),
  public.release_hold(uuid, text),
  public.demo_confirm_payment(uuid, text),
  public.find_booking(text, text),
  public.request_cancellation(text, text, text),
  public.join_waitlist(date, text, int, jsonb)
to anon, authenticated;

grant execute on function
  public.admin_create_booking(date, jsonb, jsonb, text, boolean, text, uuid),
  public.admin_update_booking(uuid, jsonb, text),
  public.admin_reschedule(uuid, date, jsonb),
  public.admin_cancel(uuid, boolean, boolean, text),
  public.admin_resolve_cancel_request(uuid, boolean, boolean),
  public.admin_set_attendance(uuid, text),
  public.admin_mark_paid(uuid),
  public.admin_add_block(date, text, int, int, text),
  public.admin_remove_block(uuid),
  public.admin_update_settings(jsonb),
  public.admin_save_discount(text, text, numeric, boolean, date, int),
  public.admin_delete_discount(text)
to authenticated;

-- Live updates for the calendar and the admin.
alter publication supabase_realtime add table public.booking_slots, public.blocks, public.settings,
  public.bookings, public.waitlist;
