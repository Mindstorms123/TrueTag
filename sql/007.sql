-- TrueTag migration 007: cast digest hash algorithm to text
-- Some Supabase/Postgres environments require an explicit text cast for the digest algorithm argument.

create extension if not exists pgcrypto;

create or replace function public.truetag_build_product_key(p_model_number text, p_asin text, p_title text)
returns text
language sql
immutable
as $$
  select encode(
    digest(
      convert_to(
        coalesce(
          nullif(truetag_normalize_text(p_model_number), ''),
          nullif(truetag_normalize_text(p_asin), ''),
          nullif(truetag_normalize_text(p_title), ''),
          'truetag-unknown-product'
        ),
        'UTF8'
      ),
      'sha256'::text
    ),
    'hex'::text
  );
$$;

grant execute on function public.truetag_build_product_key(text, text, text) to service_role;