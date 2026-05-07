-- TrueTag migration 005: bring sql/004 schema to current app expectations
-- Adds columns, indexes and replaces trigger function + view to match the workspace version.

-- Add missing columns to store_offers (safe/idempotent)
alter table public.store_offers
  add column if not exists model_number text;

alter table public.store_offers
  add column if not exists asin text;

alter table public.store_offers
  add column if not exists product_title text;

alter table public.store_offers
  add column if not exists amazon_url text;

-- saved_at should exist and be populated for historical rows
alter table public.store_offers
  add column if not exists saved_at timestamptz not null default now();

-- Add index for model_number + store quick lookup
create index if not exists idx_store_offers_model_store_seen on public.store_offers (model_number, store_id, last_seen_at desc);

-- Replace the trigger function to ensure it upserts model/asin/product/offer fields
create or replace function public.truetag_upsert_price_history_entities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_key text;
  v_store_id uuid;
  v_product_key text;
  v_product_id uuid;
  v_offer_id uuid;
  v_product_title text;
  v_offer_url text;
begin
  v_store_key := truetag_normalize_text(coalesce(new.store, 'unknown'));
  v_product_title := coalesce(nullif(new.product_title, ''), nullif(new.page_title, ''), nullif(new.model_number, ''), nullif(new.asin, ''), new.store, 'Unknown product');
  v_offer_url := coalesce(nullif(new.offer_url, ''), nullif(new.source_url, ''));

  insert into stores (store_key, store_name)
  values (v_store_key, coalesce(new.store, initcap(v_store_key)))
  on conflict (store_key) do update
    set store_name = excluded.store_name,
        updated_at = now()
  returning id into v_store_id;

  new.store_id := v_store_id;

  v_product_key := truetag_build_product_key(new.model_number, new.asin, v_product_title);

  insert into products (canonical_key, title, title_normalized, brand, amazon_url, image_url)
  values (
    v_product_key,
    v_product_title,
    truetag_normalize_text(v_product_title),
    null,
    null,
    null
  )
  on conflict (canonical_key) do update
    set title = coalesce(excluded.title, products.title),
        title_normalized = excluded.title_normalized,
        updated_at = now()
  returning id into v_product_id;

  new.product_id := v_product_id;
  new.product_title := v_product_title;

  if new.model_number is not null and length(trim(new.model_number)) > 0 then
    insert into product_identifiers (product_id, identifier_type, identifier_value)
    values (v_product_id, 'model_number', new.model_number)
    on conflict do nothing;
  end if;

  if new.asin is not null and length(trim(new.asin)) > 0 then
    insert into product_identifiers (product_id, identifier_type, identifier_value)
    values (v_product_id, 'asin', new.asin)
    on conflict do nothing;
  end if;

  if v_offer_url is not null and length(trim(v_offer_url)) > 0 then
    insert into store_offers (
      product_id,
      store_id,
      model_number,
      asin,
      product_title,
      amazon_url,
      offer_url,
      source_url,
      source_type,
      offer_type,
      page_title,
      current_price,
      currency,
      saved_at,
      last_seen_at
    )
    values (
      v_product_id,
      v_store_id,
      nullif(new.model_number, ''),
      nullif(new.asin, ''),
      v_product_title,
      null,
      v_offer_url,
      nullif(new.source_url, ''),
      nullif(new.source_type, ''),
      nullif(new.offer_type, ''),
      nullif(new.page_title, ''),
      new.price,
      coalesce(new.currency, 'USD'),
      coalesce(new.saved_at, new.created_at, now()),
      coalesce(new.saved_at, new.created_at, now())
    )
    on conflict (store_id, offer_url_hash) do update
      set current_price = excluded.current_price,
          model_number = coalesce(excluded.model_number, store_offers.model_number),
          asin = coalesce(excluded.asin, store_offers.asin),
          product_title = coalesce(excluded.product_title, store_offers.product_title),
          amazon_url = coalesce(excluded.amazon_url, store_offers.amazon_url),
          source_url = coalesce(excluded.source_url, store_offers.source_url),
          source_type = coalesce(excluded.source_type, store_offers.source_type),
          offer_type = coalesce(excluded.offer_type, store_offers.offer_type),
          page_title = coalesce(excluded.page_title, store_offers.page_title),
          saved_at = excluded.saved_at,
          last_seen_at = excluded.last_seen_at,
          active = true
    returning id into v_offer_id;
  else
    v_offer_id := null;
  end if;

  new.offer_id := v_offer_id;
  new.model_number := nullif(new.model_number, '');
  new.offer_url := nullif(v_offer_url, '');
  new.source_url := nullif(new.source_url, '');
  new.saved_at := coalesce(new.saved_at, new.created_at, now());

  return new;
end;
$$;

-- Replace the view that the app queries for current offers
drop view if exists public.v_current_store_offers cascade;
create view public.v_current_store_offers as
select
  p.id as product_id,
  p.title as product_title,
  p.canonical_key as product_key,
  p.brand,
  p.amazon_url,
  s.id as store_id,
  s.store_key,
  s.store_name,
  s.domain,
  o.id as offer_id,
  o.model_number,
  o.asin,
  o.product_title as offer_product_title,
  o.amazon_url as offer_amazon_url,
  o.offer_url,
  o.source_url,
  o.source_type,
  o.offer_type,
  o.page_title,
  o.current_price,
  o.currency,
  o.saved_at,
  o.first_seen_at,
  o.last_seen_at,
  o.active
from store_offers o
join products p on p.id = o.product_id
join stores s on s.id = o.store_id
where o.active = true;

-- Ensure execute rights for service_role on the trigger function
revoke all on function truetag_upsert_price_history_entities() from public;
grant execute on function truetag_upsert_price_history_entities() to service_role;

-- Done.
