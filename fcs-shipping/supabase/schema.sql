-- FCS Shipping — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.

-- ============ TABLES ============

create table if not exists shipments (
  id             uuid primary key default gen_random_uuid(),
  waybill_no     text unique not null,
  customer_name  text not null,
  customer_phone text not null,
  cargo          text not null,
  destination    text not null,
  status         text not null default 'received'
                 check (status in ('received','loaded','at_sea','arrived','ready','delivered')),
  vessel         text,
  eta            date,
  created_at     timestamptz not null default now()
);

create table if not exists shipment_events (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  status      text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists quote_requests (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  phone             text not null,
  email             text not null,
  cargo             text not null,
  quantity          int  not null default 1,
  destination       text not null,
  extras            jsonb not null default '[]',
  total_cents       int  not null,
  status            text not null default 'new'
                    check (status in ('new','handled','deposit_paid')),
  stripe_session_id text,
  deposit_cents     int,
  created_at        timestamptz not null default now()
);

create table if not exists sailings (
  id      uuid primary key default gen_random_uuid(),
  vessel  text not null,
  departs date not null,
  arrives date not null,
  cutoff  date not null,
  status  text not null default 'open'
          check (status in ('open','closing','closed','sailed'))
);

-- key/value store for prices & fees editable from the admin dashboard
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ============ WAYBILL NUMBER GENERATOR (FCS-YYYY-XXXX) ============

create sequence if not exists waybill_seq start 1000;

create or replace function generate_waybill()
returns text
language sql
security definer
as $$
  select 'FCS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('waybill_seq')::text, 4, '0');
$$;

-- ============ ROW LEVEL SECURITY ============
-- Public (anon) can read sailings only. Everything else requires a logged-in
-- staff member (Supabase Auth) or the service-role key used by the serverless
-- functions. Tracking goes through the serverless function so customer
-- name/phone never reach the browser.

alter table shipments       enable row level security;
alter table shipment_events enable row level security;
alter table quote_requests  enable row level security;
alter table sailings        enable row level security;
alter table settings        enable row level security;

-- anon: sailing schedule is public
create policy "public read sailings" on sailings
  for select to anon using (true);

-- anon: prices/settings are public (they're shown on the site anyway)
create policy "public read settings" on settings
  for select to anon using (true);

-- staff (any authenticated user): full access.
-- Only people YOU invite in Supabase → Authentication → Users can log in.
create policy "staff all shipments"       on shipments       for all to authenticated using (true) with check (true);
create policy "staff all shipment_events" on shipment_events for all to authenticated using (true) with check (true);
create policy "staff all quote_requests"  on quote_requests  for all to authenticated using (true) with check (true);
create policy "staff all sailings"        on sailings        for all to authenticated using (true) with check (true);
create policy "staff all settings"        on settings        for all to authenticated using (true) with check (true);

grant execute on function generate_waybill() to authenticated;

-- ============ SEED DATA (safe to delete later) ============

insert into sailings (vessel, departs, arrives, cutoff, status) values
  ('M/V Caribbean Star', '2026-07-28', '2026-08-09', '2026-07-26', 'closing'),
  ('M/V Island Trader',  '2026-08-06', '2026-08-18', '2026-08-04', 'open'),
  ('M/V Windward Belle', '2026-08-15', '2026-08-27', '2026-08-13', 'open'),
  ('M/V Caribbean Star', '2026-08-24', '2026-09-05', '2026-08-22', 'open')
on conflict do nothing;

-- demo shipment so tracking works immediately (waybill FCS-2026-4471)
with s as (
  insert into shipments (waybill_no, customer_name, customer_phone, cargo, destination, status, vessel, eta)
  values ('FCS-2026-4471', 'Demo Customer', '(718) 000-0000', 'Barrel (55 gal) × 1', 'Port Castries', 'at_sea', 'M/V Caribbean Star', '2026-07-28')
  on conflict (waybill_no) do nothing
  returning id
)
insert into shipment_events (shipment_id, status, note, created_at)
select id, e.status, e.note, e.created_at from s,
  (values
    ('received', '9502 Ditmas Ave',            timestamptz '2026-07-14 10:22:00-04'),
    ('loaded',   'Container BKLN-88',           timestamptz '2026-07-17 15:05:00-04'),
    ('at_sea',   'Aboard M/V Caribbean Star',   timestamptz '2026-07-19 08:00:00-04')
  ) as e(status, note, created_at);
