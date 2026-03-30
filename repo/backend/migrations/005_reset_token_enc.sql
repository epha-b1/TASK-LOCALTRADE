ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS token_enc TEXT;
