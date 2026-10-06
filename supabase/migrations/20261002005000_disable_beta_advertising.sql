-- Keep the legacy sponsor tables for audit/history, but make advertising
-- unreachable in the beta.  The application has no sponsor UI or request
-- path, and direct browser calls cannot fetch campaigns or record events.
drop policy if exists active_sponsors_public_read on public.sponsors;
drop policy if exists active_campaigns_public_read on public.sponsor_campaigns;

revoke all on function public.record_sponsor_event(uuid, text)
  from public, anon, authenticated;
