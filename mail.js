/* ===================================================================
   ORBIS SCHEDULE — outgoing mail (Gmail API)
   -------------------------------------------------------------------
   Sends a plain-text email as the authenticated account (juan@3dus.us)
   using the gmail.send scope. Used for the internal booking
   notification that goes to your team — never to the client.

   Requires the refresh token to include:
     https://www.googleapis.com/auth/gmail.send
   (see SETUP.md, Step 2). No extra dependency — Gmail ships inside the
   same `googleapis` package already used for Calendar.
   ================================================================ */

import { getGmail } from './google.js';

// RFC 2047 encode a header only if it contains non-ASCII (e.g. "⚠").
function encodeHeader(s) {
  return /^[\x00-\x7F]*$/.test(s)
    ? s
    : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

// base64url, as the Gmail `raw` field expects (no +/ or trailing =).
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Send a plain-text UTF-8 email.
 * @param {object} o
 * @param {string} o.to       recipient (falls back to `from`)
 * @param {string} o.subject  subject line (non-ASCII handled)
 * @param {string} o.text     plain-text body
 * @param {string} [o.from]   From address (defaults to `to`; Gmail sends as the authed user)
 */
export async function sendMail({ to, subject, text, from }) {
  const gmail = getGmail();
  const sender = from || to;
  if (!to) throw new Error('sendMail: missing "to"');

  // Body as base64 so any UTF-8 (— · ⚠) survives transport intact.
  const bodyB64 = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

  const mime =
    `From: ${sender}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${encodeHeader(subject)}\r\n` +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: text/plain; charset="UTF-8"\r\n' +
    'Content-Transfer-Encoding: base64\r\n' +
    '\r\n' +
    bodyB64 + '\r\n';

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: b64url(Buffer.from(mime, 'utf8')) },
  });
}
