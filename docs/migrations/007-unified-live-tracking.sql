-- Migración 007: seguimiento unificado de RodandoUTP GreenShare 7.0.
-- Idempotente y no destructiva. No conserva historial de posiciones GPS.

CREATE TABLE IF NOT EXISTS live_trips (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'en_camino'
    CHECK (status IN ('en_camino','recogiendo','en_ruta','finalizado')),
  lat DOUBLE PRECISION CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng DOUBLE PRECISION CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 100),
  speed_ms DOUBLE PRECISION CHECK (speed_ms IS NULL OR speed_ms BETWEEN 0 AND 60),
  heading DOUBLE PRECISION CHECK (heading IS NULL OR heading BETWEEN 0 AND 360),
  consent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_live_trips_active ON live_trips(status, updated_at)
  WHERE status <> 'finalizado';

CREATE TABLE IF NOT EXISTS live_seat_requests (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  passenger_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 3),
  pickup_label VARCHAR(120) NOT NULL,
  pickup_lat DOUBLE PRECISION CHECK (pickup_lat IS NULL OR pickup_lat BETWEEN -90 AND 90),
  pickup_lng DOUBLE PRECISION CHECK (pickup_lng IS NULL OR pickup_lng BETWEEN -180 AND 180),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_request_pending
  ON live_seat_requests(ride_id, passenger_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_live_request_driver
  ON live_seat_requests(ride_id, status, created_at);

CREATE TABLE IF NOT EXISTS live_proximity_notices (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proximity_code VARCHAR(12) NOT NULL CHECK (proximity_code IN ('yellow','orange','red')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, user_id, proximity_code)
);
