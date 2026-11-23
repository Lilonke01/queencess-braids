CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  style TEXT NOT NULL,
  area TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  starts INTEGER NOT NULL,
  duration INTEGER NOT NULL,
  clientName TEXT NOT NULL,
  clientPhone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  createdAt TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX bookings_date_status ON bookings(date,status);
--> statement-breakpoint
CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE login_attempts (address TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(address,bucket));
