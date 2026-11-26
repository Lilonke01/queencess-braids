CREATE TABLE owner_push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  lastAcceptedAt TEXT,
  lastError TEXT NOT NULL DEFAULT ''
);
