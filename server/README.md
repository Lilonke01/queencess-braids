# Backend development

The Node.js backend stores bookings in SQLite and serves the existing website at the same address. Node 24 or newer is required. There are no npm dependencies.

## Start

In PowerShell, set a private owner key and start the server.

```powershell
$env:OWNER_API_KEY = 'replace-with-a-private-secret-at-least-32-characters-long'
npm start
```

Open http://127.0.0.1:3000. The website currently uses its browser demo flow. The API is ready for the next frontend integration.

## API

- GET /api/health returns server health.
- POST /api/bookings accepts JSON with style, area, date, time and an optional mapLink. Dates use YYYY-MM-DD, times use HH:mm in South African time, and map links must use HTTPS. It returns the booking ID and Pending status.
- GET /api/owner/bookings returns the latest 100 bookings.
- PATCH /api/owner/bookings/{id} accepts JSON with status set to Accepted or Declined.

Owner endpoints require an Authorization header containing Bearer followed by OWNER_API_KEY. Keep this key on the server or in a trusted owner client. Do not embed it in the public website.

The database lives in data/bookings.sqlite and is excluded from Git. DATA_DIRECTORY can select a persistent storage directory. PORT defaults to 3000 and HOST defaults to 127.0.0.1.

## Remaining integration

Connect the booking form to POST /api/bookings and build an authenticated owner interface. Add owner sessions and deployment configuration before enabling the backend on the hosted site. Existing browser demo records remain on their original devices. Use fictional locations and test data during assignment review.
