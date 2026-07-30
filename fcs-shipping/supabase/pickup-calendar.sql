-- Pickup calendar + quote upgrades (run once in Supabase → SQL editor)
-- 1. Bookable pickup/drop-off time slots with 15-minute holds
create table if not exists pickup_slots (
  id uuid primary key default gen_random_uuid(),
  slot_date date not null,
  slot_time text not null,
  status text not null default 'open' check (status in ('open','held','booked','closed')),
  held_until timestamptz,
  booked_name text,
  booked_phone text,
  booked_email text,
  quote_id uuid,
  created_at timestamptz not null default now(),
  unique (slot_date, slot_time)
);

alter table pickup_slots enable row level security;
drop policy if exists "staff all pickup_slots" on pickup_slots;
create policy "staff all pickup_slots" on pickup_slots
  for all using (is_staff()) with check (is_staff());
-- The public site reads/holds/books slots ONLY through serverless functions
-- (service role), which never expose booked customers' details.

-- 2. Quote requests: optional address + booked pickup time
alter table quote_requests add column if not exists address text;
alter table quote_requests add column if not exists pickup_slot text;

-- 3. EB/Ls already carry customer_email; shipments learn their EB/L
alter table ebl add column if not exists customer_email text;
alter table shipments add column if not exists ebl_no text;
