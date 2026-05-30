-- ============================================================
--  KEUANGANKU - Explicit Supabase Data API grants
--  007_explicit_data_api_grants.sql
--
--  Supabase Data API access is no longer implicitly granted for
--  new public tables. Keep table access explicit and authenticated-only;
--  existing RLS policies still decide which rows each user may access.
-- ============================================================

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.categories to authenticated;
grant select, insert, update, delete on table public.recurring_templates to authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;
grant select, insert, update, delete on table public.portfolio_pockets to authenticated;
grant select, insert, update, delete on table public.portfolio_assets to authenticated;
grant select, insert, update, delete on table public.portfolio_activity_log to authenticated;

grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.categories to service_role;
grant select, insert, update, delete on table public.recurring_templates to service_role;
grant select, insert, update, delete on table public.expenses to service_role;
grant select, insert, update, delete on table public.portfolio_pockets to service_role;
grant select, insert, update, delete on table public.portfolio_assets to service_role;
grant select, insert, update, delete on table public.portfolio_activity_log to service_role;

revoke all on function public.get_pending_users() from public;
revoke all on function public.get_approved_users() from public;
revoke all on function public.approve_user(uuid) from public;
revoke all on function public.reject_user(uuid) from public;
revoke all on function public.cleanup_soft_deleted_rows(boolean) from public;

grant execute on function public.get_pending_users() to authenticated, service_role;
grant execute on function public.get_approved_users() to authenticated, service_role;
grant execute on function public.approve_user(uuid) to authenticated, service_role;
grant execute on function public.reject_user(uuid) to authenticated, service_role;
grant execute on function public.cleanup_soft_deleted_rows(boolean) to authenticated, service_role;

revoke all on function public.handle_new_user() from public;
revoke all on function public.update_recurring_last_logged() from public;
revoke all on function public.set_updated_at() from public;
