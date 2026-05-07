-- Add metadata columns for saved competitor offers and source tracking
ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS offer_url TEXT,
  ADD COLUMN IF NOT EXISTS offer_type TEXT,
  ADD COLUMN IF NOT EXISTS page_title TEXT,
  ADD COLUMN IF NOT EXISTS saved_at TIMESTAMP;

-- Help lookups by product and store when building the Amazon overlay
CREATE INDEX IF NOT EXISTS idx_price_history_model_number_store_created_at
ON price_history(model_number, store, created_at DESC);

-- Optional helper index for latest saved offer per store
CREATE INDEX IF NOT EXISTS idx_price_history_model_number_store_saved_at
ON price_history(model_number, store, saved_at DESC);
