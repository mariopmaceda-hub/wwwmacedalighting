
alter policy "Anyone can upload quote photos"
on storage.objects
to anon, authenticated
with check (bucket_id = 'quote-photos');
