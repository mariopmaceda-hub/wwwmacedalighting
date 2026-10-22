
create index if not exists lead_followup_audit_quote_idx
  on public.lead_followup_audit (quote_id);

create index if not exists lead_followup_state_initial_message_idx
  on public.lead_followup_state (initial_response_message_id)
  where initial_response_message_id is not null;
