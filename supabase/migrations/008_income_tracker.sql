-- ============================================================
--  INCOME TRACKER
-- ============================================================

create table if not exists public.income_entries (
  id                    uuid primary key,
  user_id               uuid not null references auth.users(id) on delete cascade,
  title                 text not null,
  source_type           text not null,

  asset_type            text not null check (asset_type in ('FIAT','CRYPTO')),
  amount                numeric not null check (amount > 0),
  ticker                text,
  coingecko_id          text,
  currency              text not null check (currency in ('IDR','USD')),
  price_at_time         numeric,
  is_manual_price       boolean not null default false,
  value_usd             numeric not null default 0,
  value_idr             numeric not null default 0,

  has_cost_basis        boolean not null default false,
  cost_amount           numeric,
  cost_ticker           text,
  cost_coingecko_id     text,
  cost_price_per_unit   numeric,
  cost_is_manual_price  boolean not null default false,
  cost_value_usd        numeric,
  cost_value_idr        numeric,

  chain                 text,
  platform              text,
  pocket_id             uuid references public.portfolio_pockets(id) on delete set null,
  contract_address      text,
  mcap_at_time          numeric,
  cost_mcap             numeric,
  token_ticker          text,
  token_price_entry     numeric,
  token_price_exit      numeric,
  date                  date not null,
  note                  text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  synced                boolean not null default true
);

alter table public.income_entries enable row level security;

drop policy if exists "income_entries_owner_only" on public.income_entries;
create policy "income_entries_owner_only"
  on public.income_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_income_user_date on public.income_entries (user_id, date desc);
create index if not exists idx_income_user_updated on public.income_entries (user_id, updated_at desc);

drop trigger if exists income_entries_set_updated_at on public.income_entries;
create trigger income_entries_set_updated_at
  before update on public.income_entries
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on table public.income_entries to authenticated;
grant select, insert, update, delete on table public.income_entries to service_role;
