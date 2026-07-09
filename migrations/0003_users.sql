CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL DEFAULT 'client',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id);
