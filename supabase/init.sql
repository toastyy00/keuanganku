-- ============================================================
--  KEUANGANKU - Fresh Install (Combined 001 + 002)
--
--  Purpose:
--  - One-file bootstrap for NEW self-host installations only.
--  - This file combines:
--      1) supabase/migrations/001_init.sql
--      2) supabase/migrations/002_local_first_sync.sql
--
--  IMPORTANT:
--  - Use this file ONLY for fresh installs.
--  - Do not run together with 001/002 in the same database lifecycle.
-- ============================================================

-- ==================== BEGIN 001_init.sql ====================
-- ============================================================
--  KEUANGANKU - Supabase Database Migration
--  001_init.sql (AUTH MODE - per-user data with RLS)
--
--  Run this in the Supabase Dashboard -> SQL Editor,
--  or via: supabase db reset
-- ============================================================

-- Drop existing tables (clean slate for fresh auth setup)
DROP TABLE IF EXISTS public.expenses CASCADE;
DROP TABLE IF EXISTS public.recurring_templates CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Drop existing triggers on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
--  TABLE: profiles
-- ============================================================

CREATE TABLE public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT        NOT NULL DEFAULT '',
  is_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
--  TABLE: categories
-- ============================================================

CREATE TABLE public.categories (
  slug        TEXT        NOT NULL,
  label       TEXT        NOT NULL,
  emoji       TEXT        NOT NULL DEFAULT '',
  is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (slug, user_id)
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own categories"
  ON public.categories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own categories"
  ON public.categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own categories"
  ON public.categories FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own non-default categories"
  ON public.categories FOR DELETE
  USING (auth.uid() = user_id AND is_default = FALSE);

-- ============================================================
--  TABLE: recurring_templates
-- ============================================================

CREATE TABLE public.recurring_templates (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  amount          NUMERIC     NOT NULL CHECK (amount >= 0),
  currency        TEXT        NOT NULL CHECK (currency IN ('IDR', 'USD')),
  category        TEXT        NOT NULL,
  type            TEXT        NOT NULL CHECK (type IN ('NEED', 'WANT', 'TRANSFER')),
  frequency       TEXT        NOT NULL CHECK (frequency IN ('monthly', 'weekly')),
  schedule_detail TEXT,
  note            TEXT,
  last_logged     DATE,
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recurring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own recurring templates"
  ON public.recurring_templates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recurring templates"
  ON public.recurring_templates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recurring templates"
  ON public.recurring_templates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own recurring templates"
  ON public.recurring_templates FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
--  TABLE: expenses
-- ============================================================

CREATE TABLE public.expenses (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  amount        NUMERIC     NOT NULL CHECK (amount >= 0),
  currency      TEXT        NOT NULL CHECK (currency IN ('IDR', 'USD')),
  destination   TEXT,
  category      TEXT        NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('NEED', 'WANT', 'TRANSFER')),
  date          DATE        NOT NULL,
  note          TEXT,
  is_recurring  BOOLEAN     NOT NULL DEFAULT FALSE,
  recurring_id  UUID        REFERENCES public.recurring_templates(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  synced        BOOLEAN     NOT NULL DEFAULT TRUE
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own expenses"
  ON public.expenses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own expenses"
  ON public.expenses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own expenses"
  ON public.expenses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own expenses"
  ON public.expenses FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
--  INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_expenses_user_date     ON public.expenses (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_type          ON public.expenses (type);
CREATE INDEX IF NOT EXISTS idx_expenses_category      ON public.expenses (category);
CREATE INDEX IF NOT EXISTS idx_recurring_user_active  ON public.recurring_templates (user_id, active);
CREATE INDEX IF NOT EXISTS idx_categories_user        ON public.categories (user_id);

-- ============================================================
--  FUNCTION: auto-update recurring template last_logged
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_recurring_last_logged()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.recurring_id IS NOT NULL THEN
    UPDATE public.recurring_templates
    SET last_logged = NEW.date
    WHERE id = NEW.recurring_id
      AND user_id = NEW.user_id
      AND (last_logged IS NULL OR last_logged < NEW.date);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_expense_update_recurring ON public.expenses;
CREATE TRIGGER trg_expense_update_recurring
  AFTER INSERT ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_recurring_last_logged();

-- ============================================================
--  FUNCTION + TRIGGER: auto-create profile + seed categories
--  Fires on every new auth.users insert (i.e. every registration)
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile row
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', '')
  );

  -- Seed 11 default categories for this user
  INSERT INTO public.categories (slug, label, emoji, is_default, user_id) VALUES
    ('tagihan',   'Tagihan',      '⚡',      TRUE, NEW.id),
    ('keperluan', 'Keperluan',    '🛍️',     TRUE, NEW.id),
    ('makan',     'Makan',        '🍜',      TRUE, NEW.id),
    ('transport', 'Transportasi', '🚗',      TRUE, NEW.id),
    ('health',    'Kesehatan',    '💊',      TRUE, NEW.id),
    ('lifestyle', 'Lifestyle',    '👟',      TRUE, NEW.id),
    ('gadget',    'Gadget',       '📱',      TRUE, NEW.id),
    ('digital',   'Digital',      '💻',      TRUE, NEW.id),
    ('sedekah',   'Sedekah',      '🤲',      TRUE, NEW.id),
    ('hadiah',    'Hadiah',       '🎁',      TRUE, NEW.id),
    ('keluarga',  'Keluarga',     '👨‍👩‍👧', TRUE, NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
--  ADMIN FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_pending_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.profiles.id = auth.uid() AND public.profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied. You are not an admin.';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    (u.raw_user_meta_data->>'display_name')::TEXT as display_name
  FROM auth.users u
  WHERE (u.raw_user_meta_data->>'is_approved')::boolean = false
     OR u.raw_user_meta_data->>'is_approved' = 'false'
     OR u.raw_user_meta_data->>'is_approved' IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.approve_user(target_user_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.profiles.id = auth.uid() AND public.profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied. You are not an admin.';
  END IF;

  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
        COALESCE(raw_user_meta_data, '{}'::jsonb),
        '{is_approved}',
        'true'::jsonb
      )
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.reject_user(target_user_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.profiles.id = auth.uid() AND public.profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied. You are not an admin.';
  END IF;

  -- Protect against deleting other admins (just in case)
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.profiles.id = target_user_id AND public.profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Cannot delete another admin.';
  END IF;

  -- Delete from auth.users (cascades to profiles, categories, expenses, etc.)
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_approved_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  is_admin BOOLEAN
) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.profiles.id = auth.uid() AND public.profiles.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied. You are not an admin.';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    (u.raw_user_meta_data->>'display_name')::TEXT as display_name,
    COALESCE(p.is_admin, FALSE) as is_admin
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE (u.raw_user_meta_data->>'is_approved')::boolean = true
     OR u.raw_user_meta_data->>'is_approved' = 'true';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
--  COMMENTS
-- ============================================================

COMMENT ON TABLE public.profiles           IS 'One profile per authenticated user.';
COMMENT ON COLUMN public.profiles.is_admin IS 'Set to TRUE manually in dashboard to grant admin privileges.';
COMMENT ON TABLE public.expenses           IS 'Expense entries scoped to auth.uid().';
COMMENT ON TABLE public.recurring_templates IS 'Recurring expense templates scoped to auth.uid().';
COMMENT ON TABLE public.categories         IS 'Expense categories scoped to auth.uid(). Seeded on register.';


-- ==================== BEGIN 002_local_first_sync.sql ====================
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



