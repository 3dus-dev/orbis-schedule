/* ===================================================================
   ORBIS SCHEDULE — Google Calendar client
   -------------------------------------------------------------------
   Auth: OAuth 2.0 with a long-lived REFRESH TOKEN for your own account
   (juan@3dus.us). This is Google's recommended alternative to service-
   account keys — and it works even when your org blocks key creation
   (iam.disableServiceAccountKeyCreation). Because the backend acts as
   you, it can attach real Google Meet links and invite the client.

   Env vars (all set in Vercel, never committed):
     GOOGLE_OAUTH_CLIENT_ID       → OAuth client ID (Web application)
     GOOGLE_OAUTH_CLIENT_SECRET   → OAuth client secret
     GOOGLE_OAUTH_REFRESH_TOKEN   → refresh token for juan@3dus.us
     CALENDAR_ID                  → 'primary' (or a specific calendar id)
     ALLOWED_ORIGIN               → https://www.orbisdesign.group  (CORS)

   How to obtain the refresh token (no terminal) is in SETUP.md.
   ================================================================ */

import { google } from 'googleapis';

let cached = null;

export function getCalendar() {
  if (cached) return cached;

  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!id || !secret || !refresh) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN');
  }

  // The OAuth2 client automatically exchanges the refresh token for a
  // short-lived access token on each call — nothing to manage.
  const oauth2 = new google.auth.OAuth2(id, secret);
  oauth2.setCredentials({ refresh_token: refresh });

  cached = google.calendar({ version: 'v3', auth: oauth2 });
  return cached;
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
