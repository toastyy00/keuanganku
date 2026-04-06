-- ============================================================
--  KEUANGANKU — Supabase Database Migration
--  001_init.sql (AUTH MODE — per-user data with RLS)
--
--  Run this in the Supabase Dashboard → SQL Editor,
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
    ('tagihan',   'Tagihan',      '⚡',     TRUE, NEW.id),
    ('dapur',     'Belanja',      '🛒',     TRUE, NEW.id),
    ('makan',     'Makan',        '🍜',     TRUE, NEW.id),
    ('transport', 'Transportasi', '🚗',     TRUE, NEW.id),
    ('health',    'Kesehatan',    '💊',     TRUE, NEW.id),
    ('fashion',   'Fashion',      '👕',     TRUE, NEW.id),
    ('gadget',    'Gadget',       '📱',     TRUE, NEW.id),
    ('digital',   'Digital',      '🎮',     TRUE, NEW.id),
    ('donasi',    'Donasi',       '🤲',     TRUE, NEW.id),
    ('hadiah',    'Hadiah',       '🎁',     TRUE, NEW.id),
    ('keluarga',  'Keluarga',     '👨‍👩‍👧',   TRUE, NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
--  COMMENTS
-- ============================================================

COMMENT ON TABLE public.profiles           IS 'One profile per authenticated user.';
COMMENT ON TABLE public.expenses           IS 'Expense entries scoped to auth.uid().';
COMMENT ON TABLE public.recurring_templates IS 'Recurring expense templates scoped to auth.uid().';
COMMENT ON TABLE public.categories         IS 'Expense categories scoped to auth.uid(). Seeded on register.';
