/* ===================================================================
   ORBIS SCHEDULE — Google client (Calendar + Gmail)
   -------------------------------------------------------------------
   Auth: OAuth 2.0 with a long-lived REFRESH TOKEN for your own account
   (juan@3dus.us). This is Google's recommended alternative to service-
   account keys — and it works even when your org blocks key creation
   (iam.disableServiceAccountKeyCreation). Because the backend acts as
   you, it can attach real Google Meet links, invite the client, and
   send the internal booking notification from your own mailbox.

   SCOPES the refresh token must include (see SETUP.md, Step 2):
     https://www.googleapis.com/auth/calendar    → read + create events
     https://www.googleapis.com/auth/gmail.send   → send the team email

   Env vars (all set in Vercel, never committed):
     GOOGLE_OAUTH_CLIENT_ID       → OAuth client ID (Web application)
     GOOGLE_OAUTH_CLIENT_SECRET   → OAuth client secret
     GOOGLE_OAUTH_REFRESH_TOKEN   → refresh token for juan@3dus.us
     CALENDAR_ID                  → 'primary' (or a specific calendar id)
     ALLOWED_ORIGIN               → https://www.orbisdesign.group  (CORS)
     NOTIFY_EMAIL                 → where the internal booking email goes

   How to obtain the refresh token (no terminal) is in SETUP.md.
   ================================================================ */

import { google } from 'googleapis';

// One shared OAuth2 client, reused by the Calendar and Gmail clients.
let oauth = null;
function authClient() {
  if (oauth) return oauth;

  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN');
  }

  // The OAuth2 client automatically exchanges the refresh token for a
  // short-lived access token on each call — nothing to manage.
  oauth = new google.auth.OAuth2(id, secret);
  oauth.setCredentials({ refresh_token: refresh });
  return oauth;
}

let calCache = null;
let gmailCache = null;

export function getCalendar() {
  if (!calCache) calCache = google.calendar({ version: 'v3', auth: authClient() });
  return calCache;
}

export function getGmail() {
  if (!gmailCache) gmailCache = google.gmail({ version: 'v1', auth: authClient() });
  return gmailCache;
}

export const CALENDAR_ID = () => process.env.CALENDAR_ID || 'primary';

/* Shared CORS — call at the top of every handler. Returns true if the
   request was an OPTIONS preflight (already answered). */
export function cors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
