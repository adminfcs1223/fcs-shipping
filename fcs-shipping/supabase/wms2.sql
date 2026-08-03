-- ============================================================
-- FCS WMS v2 — loads become DESTINATION GROUPS (run once)
-- Shipment (SHIP-…) → Loads (LOAD-… one per destination batch)
--   → Items (individual EB/Ls with piece counts)
-- ============================================================

-- loads can now be 'open' groups
alter table wms_loads drop constraint if exists wms_loads_status_check;
alter table wms_loads add constraint wms_loads_status_check
  check (status in ('open','expected','in_warehouse','shipped','closed'));

-- individual EB/Ls living inside a load
create table if not exists wms_items (
  id uuid primary key default gen_random_uuid(),
  ebl_no text,
  order_inv text,
  customer_name text,
  cargo text,
  pieces int not null default 1,
  destination text,
  sector text check (sector in ('A','B','C')),
  load_id uuid references wms_loads(id) on delete set null,
  status text not null default 'expected' check (status in ('expected','in_warehouse','shipped')),
  scanned_in_at timestamptz,
  scanned_out_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists wms_items_load_idx on wms_items(load_id);
create index if not exists wms_items_ebl_idx on wms_items(ebl_no);

alter table wms_items enable row level security;
drop policy if exists "staff all wms_items" on wms_items;
create policy "staff all wms_items" on wms_items
  for all using (is_staff()) with check (is_staff());

-- migrate any v1 per-cargo loads into items inside their own group
insert into wms_items (ebl_no, order_inv, customer_name, cargo, pieces, destination, sector,
  load_id, status, scanned_in_at, scanned_out_at, created_at)
select ebl_no, order_inv, customer_name, cargo, 1, destination, sector,
  id, status, scanned_in_at, scanned_out_at, created_at
from wms_loads where ebl_no is not null;

update wms_loads set status = 'open', ebl_no = null, order_inv = null,
  customer_name = null, cargo = null
where ebl_no is not null and status in ('expected','in_warehouse');

-- one open load per sector: find it or start it
create or replace function wms_assign_load(p_dest text) returns json
language plpgsql security definer as $$
declare v_sector text; v_id uuid; v_no text;
begin
  if not (is_staff() or coalesce(current_setting('request.jwt.claims', true)::json->>'role','') = 'service_role') then
    raise exception 'Staff only';
  end if;
  v_sector := case
    when p_dest ilike '%vieux%' then 'A'
    when p_dest ilike '%castries%' then 'B'
    else 'C' end;
  select id, load_no into v_id, v_no from wms_loads
    where sector = v_sector and status = 'open' and shipment_id is null
    order by created_at limit 1;
  if v_id is null then
    v_no := 'LOAD-' || to_char(now(),'YYYY') || '-' || lpad(nextval('wms_load_seq')::text, 4, '0');
    insert into wms_loads (load_no, destination, sector, status)
      values (v_no, p_dest, v_sector, 'open') returning id into v_id;
  end if;
  return json_build_object('id', v_id, 'load_no', v_no, 'sector', v_sector);
end $$;

select 'wms v2 ready' as ok;
