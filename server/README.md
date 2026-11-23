# Booking backend

The Node.js 24 server serves the website and booking API from the same origin. SQLite stores bookings and client records in data/bookings.sqlite by default. There are no npm dependencies.

## Run locally

Set a strong password in your environment, then run:

```powershell
$env:OWNER_USERNAME = 'owner'
$env:OWNER_PASSWORD = 'replace-with-a-unique-password-of-at-least-16-characters'
npm start
```

Open http://127.0.0.1:3000 and sign in under **Open owner dashboard**. The previous OWNER_API_KEY setting can still supply the local login password. The browser holds an expiring session token in memory, so reload requires signing in again.

## Booking workflow

Clients provide a name and phone number. South African local and international forms of the same number share a client record. The availability check and approval both account for overlapping appointments. Pending bookings do not reserve a slot.

The scheduler assumes one owner and uses 180 minutes for knotless braids, 120 for feed-in cornrows, 240 for boho braids, and 90 for lashes. Confirm these estimates with the owner before going live. Appointments use South African time and must finish by midnight.

The owner can reschedule or cancel open bookings and mark approved bookings completed or no-show after their scheduled start. Clients can see the new date, time, and status on their original booking page. The owner can call the client from the dashboard to confirm changes.

Monthly reports use the scheduled appointment month and count unique clients among completed bookings by normalized phone number. Older bookings without a client record still contribute to appointment totals.

## Deploy

Deploy the Dockerfile on a host that runs a long-lived container. Use one instance, mount persistent storage at /app/data, and route public HTTPS to port 3000. Set OWNER_USERNAME and OWNER_PASSWORD in the host's secret settings. Configure the health check at /api/health. Back up the SQLite database with the host's volume backup or SQLite's backup API. The existing static site configuration cannot run this backend.

Verify the public URL on a phone with fictional data, including client submission, owner sign-in, approval and monthly reporting, before using it for real bookings.
