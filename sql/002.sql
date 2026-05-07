CREATE TABLE price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  model_number TEXT NOT NULL,
  store TEXT NOT NULL,
  price NUMERIC NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_model_number_created_at 
ON price_history(model_number, created_at DESC);

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon insert"
ON price_history FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon select"
ON price_history FOR SELECT TO anon
USING (true);