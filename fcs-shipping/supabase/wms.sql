-- ============================================================
-- FCS WMS — warehouse management (run once in Supabase → SQL editor)
-- Shipments (vessel-level) contain Loads (individual cargo).
-- EB/L → load_no → shipment_no: the full chain.
-- ============================================================

-- vessel-level shipments (outbound sailings + expectant inbound)
create table if not exists wms_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_no text unique not null,          -- SHIP-2026-001
  vessel text,
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  departs date,
  expected_arrival date,
  status text not null default 'open' check (status in ('open','departed','arrived','closed')),
  notes text,
  created_at timestamptz not null default now()
);

-- individual cargo loads living in warehouse sectors
create table if not exists wms_loads (
  id uuid primary key default gen_random_uuid(),
  load_no text unique not null,              -- LOAD-2026-0001
  ebl_no text,                               -- the EB/L rides on the load
  order_inv text,
  customer_name text,
  cargo text,
  destination text,
  sector text check (sector in ('A','B','C')),
  shipment_id uuid references wms_shipments(id) on delete set null,
  status text not null default 'expected' check (status in ('expected','in_warehouse','shipped')),
  scanned_in_at timestamptz,
  scanned_out_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wms_loads_status_idx on wms_loads(status);
create index if not exists wms_loads_shipment_idx on wms_loads(shipment_id);

alter table wms_shipments enable row level security;
alter table wms_loads enable row level security;
drop policy if exists "staff all wms_shipments" on wms_shipments;
create policy "staff all wms_shipments" on wms_shipments
  for all using (is_staff()) with check (is_staff());
drop policy if exists "staff all wms_loads" on wms_loads;
create policy "staff all wms_loads" on wms_loads
  for all using (is_staff()) with check (is_staff());

-- number generators (staff or serverless service role)
create sequence if not exists wms_load_seq;
create sequence if not exists wms_shipment_seq;

create or replace function generate_load_no() returns text
language plpgsql security definer as $$
begin
  if not (is_staff() or coalesce(current_setting('request.jwt.claims', true)::json->>'role','') = 'service_role') then
    raise exception 'Staff only';
  end if;
  return 'LOAD-' || to_char(now(),'YYYY') || '-' || lpad(nextval('wms_load_seq')::text, 4, '0');
end $$;

create or replace function generate_shipment_no() returns text
language plpgsql security definer as $$
begin
  if not (is_staff() or coalesce(current_setting('request.jwt.claims', true)::json->>'role','') = 'service_role') then
    raise exception 'Staff only';
  end if;
  return 'SHIP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('wms_shipment_seq')::text, 3, '0');
end $$;
