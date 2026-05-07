-- TrueTag migration 008: replace pgcrypto digest hashing with built-in md5
-- This avoids pgcrypto signature issues entirely while keeping deterministic product keys.

create or replace function public.truetag_build_product_key(p_model_number text, p_asin text, p_title text)
returns text
language sql
immutable
as $$
  select md5(
    coalesce(
      nullif(truetag_normalize_text(p_model_number), ''),
      nullif(truetag_normalize_text(p_asin), ''),
      nullif(truetag_normalize_text(p_title), ''),
      'truetag-unknown-product'
    )
  );
$$;

grant execute on function public.truetag_build_product_key(text, text, text) to service_role;