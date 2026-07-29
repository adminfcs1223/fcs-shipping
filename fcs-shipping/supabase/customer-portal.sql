-- FCS Shipping — Customer portal migration (run once in Supabase SQL Editor).
-- 1) Locks staff powers to a staff list (customers can now self-register).
-- 2) Lets each signed-in customer see THEIR OWN shipments and quotes.

-- ========== 1) STAFF LIST ==========
create table if not exists staff (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table staff enable row level security;
drop policy if exists "read own staff row" on staff;
create policy "read own staff row" on staff
  for select to authenticated using (auth.uid() = user_id);

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where user_id = auth.uid()) $$;
grant execute on function is_staff() to authenticated;

-- ========== 2) STAFF-ONLY WRITE ACCESS ==========
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

-- ========== 3) CUSTOMERS SEE THEIR OWN DATA ==========
-- Staff enter the customer email on a shipment; the portal matches it to the login.
alter table shipments add column if not exists customer_email text;
create index if not exists shipments_customer_email_idx on shipments (lower(customer_email));

drop policy if exists "customers read own shipments" on shipments;
create policy "customers read own shipments" on shipments
  for select to authenticated
  using (customer_email is not null and lower(customer_email) = lower(auth.jwt()->>'email'));

drop policy if exists "customers read own events" on shipment_events;
create policy "customers read own events" on shipment_events
  for select to authenticated
  using (exists (
    select 1 from shipments s
    where s.id = shipment_id
      and lower(s.customer_email) = lower(auth.jwt()->>'email')
  ));

drop policy if exists "customers read own quotes" on quote_requests;
create policy "customers read own quotes" on quote_requests
  for select to authenticated
  using (lower(email) = lower(auth.jwt()->>'email'));

-- ========== 4) ADD YOUR STAFF ==========
-- Run once per staff member AFTER creating their login in Authentication → Users:
insert into staff (user_id)
  select id from auth.users where email = 'admin@fcsshipping.com'
  on conflict do nothing;
-- (copy the insert above and change the email for each additional staff member)
