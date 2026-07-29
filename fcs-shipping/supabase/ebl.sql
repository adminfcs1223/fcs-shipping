-- FCS Shipping — EB/L (electronic bill of lading) system.
-- Run once in Supabase SQL Editor.
-- Staff generate a pre-priced EB/L from a real B/L number; the customer enters
-- it on the website, the exact price loads, and they pay online.

create sequence if not exists ebl_seq start 1000;

create table if not exists ebl (
  id                uuid primary key default gen_random_uuid(),
  ebl_no            text unique not null,
  bl_no             text,
  cargo             text not null,
  quantity          int  not null default 1,
  cuft              numeric,
  destination       text,
  price_cents       int  not null,
  status            text not null default 'open' check (status in ('open','paid','void')),
  stripe_session_id text,
  customer_email    text,
  created_at        timestamptz not null default now()
);

alter table ebl enable row level security;

drop policy if exists "staff all ebl" on ebl;
create policy "staff all ebl" on ebl
  for all to authenticated using (is_staff()) with check (is_staff());
-- No anon access: the public site looks EB/Ls up through a serverless function
-- that returns only cargo/price fields.

create or replace function generate_ebl()
returns text language plpgsql security definer set search_path = public as
$$
begin
  if not is_staff() then
    raise exception 'Staff only';
  end if;
  return 'EBL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('ebl_seq')::text, 4, '0');
end
$$;
grant execute on function generate_ebl() to authenticated;
