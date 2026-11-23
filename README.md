# Queencess Braids

Clients can check availability and request mobile braiding or lash appointments. The owner dashboard supports approvals, declines, cancellations, rescheduling, completion, and no-shows. Monthly reporting includes completed visits and unique clients.

See the [setup and deployment guide](server/README.md) to run the booking server. Use fictional details for assignment review.

See [SPRINTS.md](SPRINTS.md) for the sprint summary and fieldwork needed for submission.

## Code map

- `dist/index.html` and `dist/booking.js` contain the customer form, owner dashboard, and report display.
- `server/index.mjs` runs the local HTTP and SQLite server. It validates requests, prevents overlapping appointments, and handles changes to booking status.
- `worker/index.js` runs the hosted reviewer API with Cloudflare D1. It accepts preset fictional clients and areas.
- `worker/build.py` uses Pillow to package the public reviewer site. The generated Worker entry is in `dist/server/`.
- `drizzle/` contains the hosted database migration and its metadata.

Follow the local setup guide above to run the website from the VS Code terminal. Open `dist/booking.js` for the browser workflow and `server/index.mjs` for the local API.
