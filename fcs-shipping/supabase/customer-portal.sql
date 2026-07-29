-- FCS Shipping — Customer portal migration.
-- ⚠️ RUN THIS BEFORE ANNOUNCING CUSTOMER ACCOUNTS.
-- The original schema gave EVERY logged-in user staff access. Now that customers
-- can create accounts at /account, staff access must be limited to a staff list.
-- Run in Supabase: SQL Editor → New query → paste → Run.

-- 1) Staff list
create table if not exists staff (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table staff enable row level security;
drop policy if exists "read own staff row" on staff;
create policy "read own staff row" on staff
  for select to authenticated using (auth.uid() = user_id);

-- 2) Helper: is the current user staff?
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = auth.uid()) $$;
grant execute on function is_staff() to authenticated;

-- 3) Replace "any logged-in user" policies with staff-only
drop policy if exists "staff all shipments"       on shipments;
drop policy if exists "staff all shipment_events" on shipment_events;
drop policy if exists "staff all quote_requests"  on quote_requests;
drop policy if exists "staff all sailings"        on sailings;
drop policy if exists "staff all settings"        on settings;

create policy "staff all shipments"       on shipments       for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff all shipment_events" on shipment_events for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff all quote_requests"  on quote_requests  for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff all sailings"        on sailings        for all to authenticated using (is_staff()) with check (is_staff());
create policy "staff all settings"        on settings        for all to authenticated using (is_staff()) with check (is_staff());

-- 4) Waybill generator: staff only (customers get an error if they try)
create or replace function generate_waybill()
returns text language plpgsql security definer set search_path = public as
$$
begin
  if not is_staff() then
    raise exception 'Staff only';
  end if;
  return 'FCS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('waybill_seq')::text, 4, '0');
end
$$;
grant execute on function generate_waybill() to authenticated;

-- 5) ADD YOUR STAFF (run once per staff member, AFTER creating their login in
--    Authentication → Users). Example:
-- insert into staff (user_id)
--   select id from auth.users where email = 'admin@fcsshipping.com'
--   on conflict do nothing;
