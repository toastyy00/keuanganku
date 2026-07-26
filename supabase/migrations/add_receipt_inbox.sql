-- ============================================================
--  Receipt Inbox — stores AI-extracted receipt data pending review
--  Part of: AI-Powered Receipt/Invoice Reader feature
-- ============================================================

CREATE TABLE public.receipt_inbox (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- AI extraction results (full structured response)
  ai_result       JSONB NOT NULL DEFAULT '{}',

  -- Parsed top-level fields for display and querying
  store_name      TEXT,
  receipt_date    DATE,
  total           NUMERIC,
  currency        TEXT NOT NULL DEFAULT 'IDR' CHECK (currency IN ('IDR', 'USD')),
  suggested_type  TEXT NOT NULL DEFAULT 'expense' CHECK (suggested_type IN ('expense', 'income')),
  item_count      INTEGER NOT NULL DEFAULT 0,

  -- Status lifecycle: processing → ready → confirmed/dismissed
  -- 'error' status used when AI processing fails
  status          TEXT NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing', 'ready', 'confirmed', 'dismissed', 'error')),
  error_message   TEXT,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);

-- Row Level Security (same pattern as other tables)
ALTER TABLE public.receipt_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipt_inbox_select" ON public.receipt_inbox
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "receipt_inbox_insert" ON public.receipt_inbox
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "receipt_inbox_update" ON public.receipt_inbox
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "receipt_inbox_delete" ON public.receipt_inbox
  FOR DELETE USING (auth.uid() = user_id);

-- Grant permissions to authenticated and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_inbox TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipt_inbox TO service_role;

-- Auto-update timestamp trigger (reusing existing function)
CREATE TRIGGER receipt_inbox_set_updated_at
  BEFORE UPDATE ON public.receipt_inbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Index for fast inbox queries (pending items for a user)
CREATE INDEX idx_receipt_inbox_user_pending
  ON public.receipt_inbox (user_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
