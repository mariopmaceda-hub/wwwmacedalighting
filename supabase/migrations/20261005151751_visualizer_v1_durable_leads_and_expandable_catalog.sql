alter table public.visualizer_sessions
 add column if not exists contact_profile jsonb not null default '{}'::jsonb,
 add column if not exists lead_quote_id uuid references public.quotes(id),
 add column if not exists photo_views jsonb not null default '{}'::jsonb,
 add column if not exists scale_calibration jsonb not null default '{}'::jsonb,
 add column if not exists design_revision integer not null default 0;
alter table public.maceda_products
 add column if not exists inventory_state text not null default 'unverified',
 add column if not exists procurement_status text not null default 'not_requested',
 add column if not exists supplier_asin text,
 add column if not exists asset_definition jsonb not null default '{}'::jsonb;
create unique index if not exists quotes_one_visualizer_lead on public.quotes(visualizer_session_id) where visualizer_session_id is not null;
create table if not exists public.maceda_decoration_types(
 id text primary key, customer_name text not null, category text not null,
 allowed_zones text[] not null, concept_geometry text not null,
 enabled boolean not null default true, display_order integer not null default 0,
 metadata jsonb not null default '{}'::jsonb
);
alter table public.maceda_decoration_types enable row level security;
revoke all on public.maceda_decoration_types from anon,authenticated;
grant all on public.maceda_decoration_types to service_role;
insert into public.maceda_decoration_types(id,customer_name,category,allowed_zones,concept_geometry,display_order) values
 ('ML-CONCEPT-WREATH','Wreath','wreath',array['front_door','windows'],'ring',1),
 ('ML-CONCEPT-GARLAND','Garland','garland',array['front_door','left_column','right_column','columns'],'drape',2),
 ('ML-CONCEPT-PATHWAY','Pathway','pathway',array['pathway'],'path',3),
 ('ML-CONCEPT-ARCHES','Arches','arches',array['pathway','front_door'],'arch',4)
on conflict(id) do nothing;