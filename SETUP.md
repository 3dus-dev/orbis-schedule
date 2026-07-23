# Orbis · Schedule — setup & deploy

A branded "qualify, then book" page for **orbisdesign.group**. Clients answer a short
questionnaire, then pick a 30-minute slot that is read **live from your Google Calendar**.
Qualified leads are confirmed instantly with a Google Meet link + invite; everyone else is
held as a tentative **⚠ REVIEW** event for you to approve. On every booking your team also gets
an **internal email** with the full lead details and the qualification result — that scoring is
kept out of the calendar event, so a confirmed client never sees it.

You'll do three things: (1) give the backend permission to use your Google Calendar,
(2) deploy the backend to Vercel, (3) paste the page into Webflow. Budget ~30 minutes.

---

## What's in this folder

```
orbis-schedule/
├─ api/
│  ├─ availability.js   → GET  /api/availability  (open slots, read from your calendar)
│  └─ book.js           → POST /api/book          (qualify + create the event)
├─ lib/
│  ├─ slots.js          → the availability math (hours, buffer, window)
│  ├─ google.js         → Google Calendar + Gmail auth + CORS
│  ├─ qualify.js        → the lead qualification rules  ← tune this
│  └─ mail.js           → sends the internal booking email (Gmail)
├─ package.json
└─ vercel.json
```

`schedule-embed.html` (delivered separately) is the front-end that goes into Webflow.

The current settings: **30-minute** meetings, **Mon–Fri 10:00–18:00 ET** (Washington, DC),
**15-minute buffer** around existing events, **same-day allowed** (2h notice) out to **14 days**,
auto **Google Meet** links. All of these live at the top of `lib/slots.js`. Eastern Time daylight
saving (EDT/EST) is handled automatically.

---

## Step 1 — Google Cloud: an OAuth client for the calendar

The backend authenticates **as you** using OAuth (a refresh token) — Google's recommended
alternative to service-account keys. This is what lets it attach a real Meet link and email the
client an invite, and it works even though your org blocks downloadable service-account keys
(`iam.disableServiceAccountKeyCreation`). No key file is ever created.

1. Go to **console.cloud.google.com** → create a project (e.g. `orbis-schedule`) or reuse one.
2. **APIs & Services → Library** → enable **two** APIs: search **Google Calendar API** → **Enable**,
   then search **Gmail API** → **Enable**. (Gmail is what sends your team the internal booking email.)
3. **APIs & Services → OAuth consent screen** → **User type: Internal** (this keeps it to your
   3dus.us org and makes the refresh token long-lived) → fill app name (`Orbis Scheduler`) and your
   support email → **Save**.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - **Application type: Web application.** Name it `orbis-scheduler`.
   - Under **Authorized redirect URIs**, add exactly:
     `https://developers.google.com/oauthplayground`
   - **Create.** Copy the **Client ID** and **Client secret** — you'll need both.

## Step 2 — Get the refresh token (no terminal, ~2 minutes)

1. Open **https://developers.google.com/oauthplayground**.
2. Click the **gear icon** (top right) → check **"Use your own OAuth credentials"** → paste the
   **Client ID** and **Client secret** from Step 1.4.
3. On the left, in **"Input your own scopes"**, paste **both** scopes (space-separated):
   `https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send`
   → click **Authorize APIs**. *(Both matter: `calendar` creates the events, `gmail.send` sends
   your team the booking email. If you already issued a calendar-only token, you must re-run this
   step with both scopes and replace the token — a token can't gain a scope after the fact.)*
4. Sign in **as juan@3dus.us** and allow access. (If it warns the app is unverified, it's your own
   internal app — continue.)
5. Back on the Playground, click **"Exchange authorization code for tokens."** Copy the
   **Refresh token** it shows. That single string is the secret the backend uses — it goes only
   into Vercel (Step 3), never into GitHub, the embed, or chat.

> If no refresh token appears, click the gear → make sure "Use your own OAuth credentials" is still
> checked, then re-run steps 3–5. Google only returns a refresh token on a fresh consent.

## Step 3 — Deploy to Vercel

Same flow as your intake backend (web UI, no terminal).

1. **github.com → New repository** → name `orbis-schedule` → Create → **"uploading an existing
   file"**. Upload the whole folder so the structure is exactly `api/`, `lib/`, `package.json`,
   `vercel.json`. Commit. *(The `lib/` folder must be included — the functions import from it.)*
2. **vercel.com → Add New → Project → Import** the `orbis-schedule` repo.
3. Before deploying, expand **Environment Variables** and add these six:

   | Key | Value |
   |-----|-------|
   | `GOOGLE_OAUTH_CLIENT_ID` | the OAuth Client ID from Step 1.4 |
   | `GOOGLE_OAUTH_CLIENT_SECRET` | the OAuth Client secret from Step 1.4 |
   | `GOOGLE_OAUTH_REFRESH_TOKEN` | the refresh token from Step 2.5 |
   | `CALENDAR_ID` | `primary` (or a specific calendar's ID) |
   | `ALLOWED_ORIGIN` | `https://www.orbisdesign.group` (your published domain) |
   | `NOTIFY_EMAIL` | where the internal booking email lands, e.g. `juan@3dus.us` (a team alias works too) |

   *(Optional: `NOTIFY_FROM` sets the From address; if omitted it defaults to `NOTIFY_EMAIL`, and
   Gmail sends as the authenticated account either way. If `NOTIFY_EMAIL` is left unset, bookings
   still work — the internal email is simply skipped.)*

4. **Deploy.** Note the domain, e.g. `https://orbis-schedule.vercel.app`.
5. If you added the env vars after the first deploy: **Deployments → newest → ⋯ → Redeploy**
   (Vercel bakes env vars in at deploy time).

**Verify:** open `https://YOUR-PROJECT.vercel.app/api/availability` in a browser. You should get
JSON with a `days` array. If you get `{"error":...}`, the calendar permission isn't wired yet —
recheck Steps 1–2. `POST`-only `/api/book` returns `Method not allowed` on a plain GET, which is
correct.

## Step 4 — Put the page into Webflow

1. In `schedule-embed.html`, set `CONFIG.API_BASE` to your Vercel URL (no trailing slash):
   ```js
   API_BASE: 'https://orbis-schedule.vercel.app',
   ```
2. In Webflow, add a page (e.g. `/schedule`). Drop an **Embed** element on it and paste the whole
   `schedule-embed.html`. **Publish.** (If Webflow's embed character limit trips, paste the
   `<style>`+`<script>` block into **Page Settings → Custom Code → Before </body>** instead, and
   leave just `<div id="orbis-schedule"></div>` in the Embed.)
3. **Point your intake chat here.** In your intake backend's `api/intake.js`, set
   `CALENDAR_URL = 'https://www.orbisdesign.group/schedule';` and redeploy — the urgency branch
   will now send people to this page.

---

## Tuning it later

- **Hours / duration / buffer / window** → the `CONFIG` block at the top of `lib/slots.js`.
  Change `WORK_START_MIN`, `WORK_END_MIN`, `SLOT_MIN`, `BUFFER_MIN`, `MIN_NOTICE_MIN`,
  `WINDOW_DAYS`. Redeploy.
- **What counts as "qualified"** → `lib/qualify.js`. Edit `THRESHOLD`, the `ICP_ROLES` list, the
  active-timeline list, the `TARGET_MARKETS` list (priority growth regions), or the hard-flag rules.
  A request auto-confirms only when it clears the threshold **and** has zero flags; otherwise it's
  held for review. Redeploy.
- **Questions / copy / lists** → the arrays near the top of the `<script>` in
  `schedule-embed.html` (`ROLES`, `PROJECT_TYPES`, `REGIONS`, `SERVICES`, `TIMELINES`, `STEPS`).
  Which fields are required lives in the `vYou`/`vPractice`/`vProject`/`vScope` functions. The
  **Market / region** answer is captured on every lead so you can track and route by geography as
  you expand.

## How a booking behaves

- **Qualified** → event created as **confirmed**, Google Meet link attached, client added as an
  attendee and emailed the invite. Client sees "You're on the calendar."
- **Not qualified** → event created as **tentative**, titled `⚠ REVIEW — …`, colored orange, with
  the client's submitted details in the description. **No invite is sent to the client.** The client
  sees "Request received — we review every inquiry personally." You approve by opening the event,
  adding the client, and confirming (or delete it to free the slot). The held slot blocks that time
  so it isn't double-booked while you decide.
- **Every booking (both cases)** → an internal email goes to `NOTIFY_EMAIL` with the meeting time,
  the Meet + event links, all the lead's answers, and the **qualification** (decision, score,
  signals, flags). The qualification lives **only** in this email — it is never written into the
  calendar event, so a confirmed client who opens the invite never sees the scoring.

## Troubleshooting

- **`/api/availability` returns `invalid_grant` or a calendar error** → the refresh token is wrong,
  or it was issued for a different account. Re-run Step 2 signed in **as juan@3dus.us** and paste the
  new token into `GOOGLE_OAUTH_REFRESH_TOKEN`, then redeploy. Also confirm the Calendar API is
  enabled (Step 1.2).
- **Refresh token stopped working after ~7 days** → the OAuth consent screen was left as "Testing"
  instead of **Internal**. Set it to **Internal** (Step 1.3), then re-issue the token (Step 2).
  Internal-app refresh tokens don't expire.
- **Booking works but no Meet link / client gets no invite** → confirm the granted scope in Step 2.3
  included `https://www.googleapis.com/auth/calendar` (not a read-only scope). Re-issue if needed.
- **Booking works but no internal email arrives** → three things to check: (1) `NOTIFY_EMAIL` is set
  in Vercel and you redeployed; (2) the **Gmail API** is enabled (Step 1.2); (3) the refresh token
  was issued with the `gmail.send` scope (Step 2.3) — a calendar-only token won't send mail, so
  re-issue it with **both** scopes and update `GOOGLE_OAUTH_REFRESH_TOKEN`. Check the function logs
  in Vercel for `internal notification email failed` — the booking itself still succeeds regardless.
- **Times look wrong** → the calendar runs on `America/New_York` (Eastern, DST handled
  automatically) in `lib/slots.js`. If you relocate, change `TZ` there (and `CONFIG.TZ` /
  `TZ_ABBR` / `TZ_LABEL` in `schedule-embed.html`).
- **Page can't reach the scheduler (CORS)** → `ALLOWED_ORIGIN` must match your published origin
  exactly (scheme + host). Use `*` temporarily to isolate the problem, then lock it back down.
- **The secret** → if the refresh token ever leaks (committed, shared, pasted), revoke it at
  **myaccount.google.com → Security → Third-party access**, re-issue via Step 2, update
  `GOOGLE_OAUTH_REFRESH_TOKEN` in Vercel, and redeploy.
