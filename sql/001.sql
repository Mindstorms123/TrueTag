drop policy if exists "public read price history" on public.price_history;
create policy "public read price history"
on public.price_history
for select
to anon, authenticated
using (true);

drop policy if exists "no direct client insert" on public.price_history;
create policy "no direct client insert"
on public.price_history
for insert
to anon, authenticated
with check (false);