CREATE TABLE IF NOT EXISTS live_arrival_notices (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code VARCHAR(12) NOT NULL DEFAULT 'arrived' CHECK (code = 'arrived'),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, user_id, code)
);
