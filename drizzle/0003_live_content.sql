ALTER TABLE bookings ADD COLUMN mapLink TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE site_content (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE photos (id TEXT PRIMARY KEY, caption TEXT NOT NULL, mime TEXT NOT NULL, createdAt TEXT NOT NULL);
