# Queencess Braids

Queencess Braids is a mobile braiding and lash salon. This assignment prototype lets a client select a braid style or lashes, preferred appointment slot and fictional travel area, then lets a reviewer act as the owner.

## Run locally

Serve the dist directory over localhost with a static web server, for example, if Python 3 is installed:

```powershell
python -m http.server 8080 --directory dist
```

Open http://localhost:8080.

## Reviewer walkthrough

1. Choose a braid style from the menu to preselect it in the form, or select Lashes in the Service field.
2. Choose a sample area, today or a future date, and a preferred time in SAST. Save the demo request and look for the pending status.
3. Open **Open salon-owner demo** and accept or decline the request. Check the updated client status beside the form.
4. Reload to confirm the decision persists. Repeat with another request to exercise the other decision.

Both roles use the same browser and origin. The open owner panel needs no test credentials. No real names, addresses or phone numbers are collected. Requests are stored on the reviewer's device and cannot be sent to another device or the salon. The sample menu needs owner confirmation, and the hero portrait is AI-generated.

See [SPRINTS.md](SPRINTS.md) for the sprint summary and fieldwork needed for submission.
