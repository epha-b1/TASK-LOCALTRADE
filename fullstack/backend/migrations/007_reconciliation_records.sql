CREATE TABLE IF NOT EXISTS reconciliation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type TEXT NOT NULL CHECK (record_type IN ('settlement_import', 'refund_confirmation')),
  external_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('inserted', 'skipped_duplicate', 'confirmed')),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  refund_id UUID REFERENCES refunds(id) ON DELETE SET NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reconciliation_record_type_created_idx
  ON reconciliation_records(record_type, created_at DESC);
