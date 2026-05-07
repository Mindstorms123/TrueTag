-- TrueTag scalable schema migration
-- This migration ignores legacy data for all new modeling decisions.
-- It keeps a compatible price_history entry point for the app, but moves the data model to normalized tables.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

-- Preserve the legacy table as an archive if it still exists.
do $$
begin
  if to_regclass('public.price_history') is not null
     and to_regclass('public.price_history_legacy') is null then
    execute 'alter table public.price_history rename to price_history_legacy';
  end if;
end $$;

create or replace function truetag_normalize_text(input_text text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(coalesce(input_text, '')), '\s+', ' ', 'g'));
$$;

create or replace function truetag_build_product_key(p_model_number text, p_asin text, p_title text)
returns text
language sql
immutable
as $$
  select encode(
    digest(
      coalesce(
        nullif(truetag_normalize_text(p_model_number), ''),
        nullif(truetag_normalize_text(p_asin), ''),
        nullif(truetag_normalize_text(p_title), ''),
        'truetag-unknown-product'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  store_key citext not null unique,
  store_name text not null,
  domain text,
  search_url_template text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  title text not null,
  title_normalized text not null,
  brand text,
  amazon_url text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_identifiers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  identifier_type text not null,
  identifier_value citext not null,
  created_at timestamptz not null default now(),
  unique (identifier_type, identifier_value),
  unique (product_id, identifier_type)
);

create table if not exists store_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  model_number text,
  asin text,
  product_title text,
  amazon_url text,
  offer_url text not null,
  offer_url_hash text generated always as (
    encode(digest(lower(coalesce(offer_url, '')), 'sha256'), 'hex')
  ) stored,
  source_url text,
  source_type text,
  offer_type text,
  page_title text,
  current_price numeric(12,2),
  currency char(3) not null default 'USD',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  saved_at timestamptz not null default now(),
  active boolean not null default true,
  unique (store_id, offer_url_hash)
);

-- High-volume event table. Partition by created_at so it can scale to many millions of rows.
create table if not exists price_history (
  id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product_id uuid references products(id) on delete set null,
  store_id uuid references stores(id) on delete set null,
  offer_id uuid references store_offers(id) on delete set null,
  model_number text,
  store text not null,
  price numeric(12,2) not null check (price > 0),
  product_title text,
  asin text,
  source_url text,
  source_type text,
  offer_url text,
  offer_type text,
  page_title text,
  saved_at timestamptz,
  currency char(3) not null default 'USD',
  primary key (id, created_at)
) partition by range (created_at);

create table if not exists price_history_default
partition of price_history default;

create index if not exists idx_stores_store_key on stores (store_key);
create index if not exists idx_products_canonical_key on products (canonical_key);
create index if not exists idx_products_title_trgm on products using gin (title_normalized gin_trgm_ops);
create index if not exists idx_product_identifiers_value on product_identifiers (identifier_type, identifier_value);
create index if not exists idx_store_offers_product_store_seen on store_offers (product_id, store_id, last_seen_at desc);
create index if not exists idx_store_offers_model_store_seen on store_offers (model_number, store_id, last_seen_at desc);
create index if not exists idx_store_offers_store_url on store_offers (store_id, offer_url_hash);
create index if not exists idx_price_history_model_number_created_at on price_history (model_number, created_at desc);
create index if not exists idx_price_history_product_store_created_at on price_history (product_id, store_id, created_at desc);
create index if not exists idx_price_history_offer_created_at on price_history (offer_id, created_at desc);
create index if not exists idx_price_history_created_at on price_history (created_at desc);

insert into stores (store_key, store_name, domain, search_url_template)
values
  ('bestbuy', 'Best Buy', 'bestbuy.com', 'https://www.bestbuy.com/site/searchpage.jsp?st={query}'),
  ('newegg', 'Newegg', 'newegg.com', 'https://www.newegg.com/p/pl?d={query}'),
  ('target', 'Target', 'target.com', 'https://www.target.com/s?searchTerm={query}'),
  ('microcenter', 'Micro Center', 'microcenter.com', 'https://www.microcenter.com/search/search_results.aspx?searchterm={query}')
on conflict (store_key) do update
set store_name = excluded.store_name,
    domain = excluded.domain,
    search_url_template = excluded.search_url_template,
    updated_at = now();

create or replace function truetag_upsert_price_history_entities()
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

create trigger trg_price_history_prepare_entities
before insert on price_history
for each row
execute function truetag_upsert_price_history_entities();

create or replace view v_current_store_offers as
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

create or replace view v_latest_price_history as
select distinct on (ph.product_id, ph.store_id)
  ph.id,
  ph.created_at,
  ph.product_id,
  ph.store_id,
  ph.offer_id,
  ph.model_number,
  ph.store,
  ph.price,
  ph.product_title,
  ph.asin,
  ph.source_url,
  ph.source_type,
  ph.offer_url,
  ph.offer_type,
  ph.page_title,
  ph.saved_at,
  ph.currency
from price_history ph
order by ph.product_id, ph.store_id, ph.created_at desc;

alter table stores enable row level security;
alter table products enable row level security;
alter table product_identifiers enable row level security;
alter table store_offers enable row level security;
alter table price_history enable row level security;

create policy "public read stores"
on stores for select
to anon, authenticated
using (true);

create policy "public read products"
on products for select
to anon, authenticated
using (true);

create policy "public read product identifiers"
on product_identifiers for select
to anon, authenticated
using (true);

create policy "public read store offers"
on store_offers for select
to anon, authenticated
using (true);

create policy "public read price history"
on price_history for select
to anon, authenticated
using (true);

revoke all on function truetag_normalize_text(text) from public;
revoke all on function truetag_build_product_key(text, text, text) from public;
revoke all on function truetag_upsert_price_history_entities() from public;

grant execute on function truetag_normalize_text(text) to service_role;
grant execute on function truetag_build_product_key(text, text, text) to service_role;
grant execute on function truetag_upsert_price_history_entities() to service_role;
