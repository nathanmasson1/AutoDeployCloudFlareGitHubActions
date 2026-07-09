CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_settings (
  client_id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO clients (id, name, email, created_at, updated_at)
VALUES ('default', 'Cliente padrao', '', datetime('now'), datetime('now'));

INSERT INTO client_settings (client_id, value, updated_at)
SELECT 'default', value, updated_at
FROM settings
WHERE key = 'cloudflare'
  AND NOT EXISTS (SELECT 1 FROM client_settings WHERE client_id = 'default');
