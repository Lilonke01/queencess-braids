CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL CHECK (length(comment) BETWEEN 10 AND 500),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Published', 'Hidden')),
  createdAt TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reviews_status_created ON reviews(status, createdAt);
