CREATE TABLE IF NOT EXISTS live_devices (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  label VARCHAR(60) NOT NULL DEFAULT 'Dispositivo IoT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_live_devices_ride ON live_devices(ride_id, revoked_at);
