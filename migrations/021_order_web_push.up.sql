CREATE TABLE IF NOT EXISTS web_push_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx
  ON web_push_subscriptions (user_id);
