-- ============================================================
--  KEUANGANKU - Local-first sync support
--  002_local_first_sync.sql
-- ============================================================

-- Add soft-delete + update cursors for incremental sync
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.recurring_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Backfill expenses.updated_at from created_at for cleaner initial cursor
UPDATE public.expenses
SET updated_at = COALESCE(created_at, NOW())
WHERE updated_at IS NULL;

-- Shared trigger function: keep updated_at current on every UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_set_updated_at ON public.expenses;
CREATE TRIGGER trg_expenses_set_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_categories_set_updated_at ON public.categories;
CREATE TRIGGER trg_categories_set_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_recurring_set_updated_at ON public.recurring_templates;
CREATE TRIGGER trg_recurring_set_updated_at
  BEFORE UPDATE ON public.recurring_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Sync-friendly indexes (per-user, newest change first)
CREATE INDEX IF NOT EXISTS idx_expenses_user_updated
  ON public.expenses (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_categories_user_updated
  ON public.categories (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recurring_user_updated
  ON public.recurring_templates (user_id, updated_at DESC);

