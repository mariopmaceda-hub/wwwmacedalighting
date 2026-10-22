
alter policy "Anyone can submit quote"
on public.quotes
to anon, authenticated
with check (true);
