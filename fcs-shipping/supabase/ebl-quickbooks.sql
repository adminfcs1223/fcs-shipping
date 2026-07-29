-- FCS Shipping — link EB/Ls to order-entry invoices and QuickBooks.
-- Run once in Supabase SQL Editor (safe to re-run).

alter table ebl add column if not exists qb_invoice_id text;
alter table ebl add column if not exists qb_invoice_no text;
alter table ebl add column if not exists order_inv     text;

create index if not exists ebl_order_inv_idx on ebl (order_inv);

-- QuickBooks OAuth tokens are stored in `settings` under key 'qb:tokens'
-- by the serverless functions using the service-role key. Staff-only RLS on
-- `settings` already keeps them out of the browser; no extra grants needed.

select 'ebl quickbooks columns ready' as status;
