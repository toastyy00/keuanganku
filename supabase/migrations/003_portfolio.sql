-- ============================================================
--  PORTFOLIO TRACKER TABLES
-- ============================================================

create table if not exists public.portfolio_pockets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('CEX', 'WEB3', 'WALLET', 'LAINNYA')),
  source text,
  color_theme text not null,
  icon text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.portfolio_assets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pocket_id uuid not null references public.portfolio_pockets(id) on delete cascade,
  ticker text not null,
  coingecko_id text,
  amount numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.portfolio_activity_log (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pocket_id uuid not null references public.portfolio_pockets(id) on delete cascade,
  asset_id uuid not null references public.portfolio_assets(id) on delete cascade,
  ticker text not null,
  action text not null check (action in ('ADD', 'REDUCE')),
  amount_change numeric not null,
  balance_after numeric not null,
  price_at_time numeric not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_portfolio_pockets_user_updated
  on public.portfolio_pockets (user_id, updated_at desc);

create index if not exists idx_portfolio_assets_user_updated
  on public.portfolio_assets (user_id, updated_at desc);

create index if not exists idx_portfolio_activity_log_user_updated
  on public.portfolio_activity_log (user_id, updated_at desc);

alter table public.portfolio_pockets enable row level security;
alter table public.portfolio_assets enable row level security;
alter table public.portfolio_activity_log enable row level security;

drop policy if exists "portfolio_pockets_owner_only" on public.portfolio_pockets;
create policy "portfolio_pockets_owner_only"
  on public.portfolio_pockets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "portfolio_assets_owner_only" on public.portfolio_assets;
create policy "portfolio_assets_owner_only"
  on public.portfolio_assets
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "portfolio_activity_log_owner_only" on public.portfolio_activity_log;
create policy "portfolio_activity_log_owner_only"
  on public.portfolio_activity_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists portfolio_pockets_set_updated_at on public.portfolio_pockets;
create trigger portfolio_pockets_set_updated_at
before update on public.portfolio_pockets
for each row execute function public.set_updated_at();

drop trigger if exists portfolio_assets_set_updated_at on public.portfolio_assets;
create trigger portfolio_assets_set_updated_at
before update on public.portfolio_assets
for each row execute function public.set_updated_at();

drop trigger if exists portfolio_activity_log_set_updated_at on public.portfolio_activity_log;
create trigger portfolio_activity_log_set_updated_at
before update on public.portfolio_activity_log
for each row execute function public.set_updated_at();
