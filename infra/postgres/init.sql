-- Demo schema for all experiments

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  amount      NUMERIC(12,2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_status_idx  ON orders(status);
CREATE INDEX IF NOT EXISTS events_type_idx    ON events(type);

-- ── Seed data ──────────────────────────────────────────────────────────────
INSERT INTO users (username, email)
SELECT
  'user_' || i,
  'user_' || i || '@example.com'
FROM generate_series(1, 1000) AS g(i)
ON CONFLICT DO NOTHING;

INSERT INTO orders (user_id, amount, status)
SELECT
  (random() * 999 + 1)::BIGINT,
  (random() * 1000)::NUMERIC(12,2),
  (ARRAY['pending','paid','shipped','cancelled'])[floor(random()*4)+1]
FROM generate_series(1, 10000)
ON CONFLICT DO NOTHING;
