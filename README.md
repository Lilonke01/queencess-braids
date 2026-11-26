# Queencess Braids

Clients can check availability and request mobile braiding or lash appointments. Pending and approved appointments reserve the complete service duration, so overlapping requests and reschedules are rejected atomically in the database. The owner selects **Done** after an approved appointment has started to remove it from the active list. Completed records remain in private appointment history and monthly reports. Declining or cancelling a request releases its reserved time.

Use the live setup instructions below to run the same backend as production. The older prototype is available separately with `npm run start:legacy`.

See [SPRINTS.md](SPRINTS.md) for the sprint summary and fieldwork needed for submission.

## Code map

- `dist/index.html` and `dist/booking.js` contain the customer form, owner dashboard, and report display.
- `server/index.mjs` runs the local HTTP and SQLite server. It validates requests, prevents overlapping appointments, and handles changes to booking status.
- `worker/index.js` runs the hosted reviewer API with Cloudflare D1. It accepts preset fictional clients and areas.
- `worker/build.py` uses Pillow to package the public reviewer site. The generated Worker entry is in `dist/server/`.
- `drizzle/` contains the hosted database migration and its metadata.

Follow the local setup guide above to run the website from the VS Code terminal. Open `dist/booking.js` for the browser workflow and `server/index.mjs` for the local API.

Visitors can leave moderated reviews with an optional display name. The owner publishes or hides them in the owner dashboard.


## Live customer website and owner management

The published site accepts customer names, normalized phone numbers, service, area, optional Google Maps link, and a future appointment time. Bookings await owner confirmation. The public booking reference reveals status and appointment time, never customer contact details. Earlier preset demo bookings are excluded from the live owner list, reports and availability calculations.

Open `/owner.html` and use the configured owner email/password. The owner can approve, decline, cancel and reschedule bookings, view monthly reports, moderate reviews, edit the welcome heading/introduction/announcement/portfolio heading, upload portfolio photos, edit captions, remove uploaded photos, choose a cover image and hide the original portfolio images. Text and metadata live in D1 (`DB`); uploaded image files live in R2 (`BUCKET`). Never put the owner password in source code or public files. Netlify forwards `/api/*` to the hosted API, including owner tokens and photo uploads.

For local use of the same hosted API logic, build the customer files with `python worker/build.py --netlify`, set `OWNER_USERNAME` and `OWNER_PASSWORD` in your environment, then run `npm run start:live`. It uses `data/live-site.sqlite` and `data/photos/`, preserving older prototype databases. Local data is separate from production. `PORT` and `DATA_DIRECTORY` can override the defaults. Run `npm test` for the booking, authentication, publishing and photo lifecycle integration checks.


## Android owner push alerts

Open the owner dashboard in Android Chrome, sign in, tap **Enable booking alerts**, and select **Allow** in the browser prompt. Then tap **Send test alert**. The push service accepting a test does not guarantee that Android displayed it: check the phone's site notification settings, internet access and battery restrictions if needed. No Telegram, email or paid notification provider is required.

A saved booking triggers an authenticated, empty Web Push message to registered owner devices. The service worker displays a generic booking alert and opens the owner dashboard when tapped; customer details are never included in the push message. The owner must sign in to view details. Alerts remain enabled on a device after sign-out until disabled with **Disable alerts on this device**. Subscriptions are stored in D1, with expired endpoints removed after a 404 or 410 response. The site stores `PUSH_PUBLIC_KEY` and `PUSH_PRIVATE_JWK` in private runtime settings. Never put the private signing key in the repository. Existing subscriptions require the same signing key across deployments.

The API only accepts known HTTPS browser push-service endpoints, uses short-lived VAPID signatures, and limits registrations to ten owner devices. Booking responses do not wait for delivery in the hosted Worker; push failures leave the saved booking intact. Tests exercise signature verification, subscription authorization, expired endpoints and notification failure handling. Android system permission and final device delivery must be checked on the owner's phone.
