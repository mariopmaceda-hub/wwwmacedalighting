create index if not exists visualizer_sessions_current_render_idx
         on public.visualizer_sessions(current_render_id)
         where current_render_id is not null;