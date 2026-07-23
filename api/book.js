/* ===================================================================
   POST /api/book
   -------------------------------------------------------------------
   Body: { start, name, email, phone, company, role, referral,
           projectType, region, size, location, services[], timeline, notes }

   Qualified lead   → confirmed event + Google Meet + invite to client.
   Unqualified lead → tentative "⚠ REVIEW" hold on the calendar, no
                      invite sent; client is told the request is pending.

   In BOTH cases an internal notification email is sent to NOTIFY_EMAIL
   (your team) with the full lead details AND the qualification result.
   The qualification is NEVER written into the calendar event, so a
   confirmed client who receives the invite never sees the scoring.

   Response:
     { status:'confirmed', meetLink, start, end }
     { status:'pending',   start, end }         // held for human review
   ================================================================ */

import { getCalendar, CALENDAR_ID, cors } from '../lib/google.js';
import { validateSlot, CONFIG } from '../lib/slots.js';
import { qualify, QUALIFY_META } from '../lib/qualify.js';
import { sendMail } from '../lib/mail.js';

const esc = (s) => String(s == null ? '' : s).trim();

/* CLIENT-SAFE event description — the lead's own submitted details only.
   No qualification score / signals / flags: a confirmed lead receives the
   calendar invite and would otherwise see them. */
function eventDescription(a, qualified) {
  const line = (label, val) => `${label}: ${val || '—'}`;
  return [
    qualified
      ? 'ORBIS · CONFIRMED PITCH MEETING'
      : '⚠ ORBIS · PENDING REVIEW — do not treat as confirmed',
    '',
    line('Name', esc(a.name)),
    line('Email', esc(a.email)),
    line('Phone', esc(a.phone)),
    line('Company', esc(a.company)),
    line('Role / client type', esc(a.role)),
    line('How they found us', esc(a.referral)),
    '',
    line('Project type', esc(a.projectType)),
    line('Market / region', esc(a.region)),
    line('Size', esc(a.size)),
    line('Location', esc(a.location)),
    line('Services', Array.isArray(a.services) ? a.services.join(', ') : esc(a.services)),
    line('Timeline', esc(a.timeline)),
    '',
    line('Notes', esc(a.notes)),
  ].join('\n');
}

/* INTERNAL email body — everything above PLUS the qualification. Goes to
   your team only (NOTIFY_EMAIL), never to the client. */
function internalEmailText(a, q, when, qualified, meetLink, eventLink) {
  return [
    qualified
      ? 'AUTO-CONFIRMED — the client has been sent a calendar invite + Google Meet link.'
      : 'HELD FOR REVIEW — no invite was sent to the client. Open the event and add them to confirm.',
    '',
    `When:  ${when}`,
    meetLink ? `Meet:  ${meetLink}` : null,
    eventLink ? `Event: ${eventLink}` : null,
    '',
    '— lead —————————————————————',
    eventDescription(a, qualified),
    '',
    '— qualification —————————————',
    `decision: ${q.qualified ? 'QUALIFIED' : 'NOT qualified'}`,
    `score:    ${q.score} (threshold ${QUALIFY_META.THRESHOLD})`,
    `signals:  ${q.reasons.join('; ') || 'none'}`,
    `flags:    ${q.flags.join('; ') || 'none'}`,
  ].filter((l) => l !== null).join('\n');
}

/* Human-readable meeting time in the studio's timezone. */
function whenStr(startISO) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    timeZone: CONFIG.TZ, timeZoneName: 'short',
  }).format(new Date(startISO));
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const a = req.body || {};
  const now = new Date();

  // --- Validate the requested slot ----------------------------------
  const v = validateSlot(a.start, now);
  if (!v.ok) return res.status(400).json({ error: 'Unavailable time', reason: v.reason });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(esc(a.email).toLowerCase())) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!esc(a.name)) return res.status(400).json({ error: 'Name is required' });

  const q = qualify(a);
  const calendar = getCalendar();
  const calId = CALENDAR_ID();

  try {
    // --- Race guard: re-check the slot is still free ----------------
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: a.start,
        timeMax: v.end,
        timeZone: CONFIG.TZ,
        items: [{ id: calId }],
      },
    });
    const busy = fb.data.calendars?.[calId]?.busy || [];
    if (busy.length) return res.status(409).json({ error: 'That time was just taken. Please pick another.' });

    // --- Build the event -------------------------------------------
    const who = esc(a.company) ? `${esc(a.name)} · ${esc(a.company)}` : esc(a.name);
    const requestBody = {
      summary: q.qualified ? `Pitch — ${who}` : `⚠ REVIEW — ${who}`,
      description: eventDescription(a, q.qualified), // client-safe — no qualification
      status: q.qualified ? 'confirmed' : 'tentative',
      start: { dateTime: a.start, timeZone: CONFIG.TZ },
      end: { dateTime: v.end, timeZone: CONFIG.TZ },
      // Orange for review, default for confirmed.
      colorId: q.qualified ? undefined : '6',
      reminders: { useDefault: true },
    };

    // Only qualified leads get an auto Meet link + calendar invite.
    if (q.qualified) {
      requestBody.attendees = [{ email: esc(a.email), displayName: esc(a.name) }];
      requestBody.conferenceData = {
        createRequest: {
          requestId: `orbis-${a.start}-${Math.random().toString(36).slice(2, 10)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    const event = await calendar.events.insert({
      calendarId: calId,
      conferenceDataVersion: q.qualified ? 1 : 0,
      sendUpdates: q.qualified ? 'all' : 'none', // client is invited only when confirmed
      requestBody,
    });

    const meetLink =
      event.data.hangoutLink ||
      event.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ||
      null;
    const eventLink = event.data.htmlLink || null;

    // --- Notify the team internally (full details + qualification) ---
    // Never blocks or fails the booking; the client already has their result.
    const notifyTo = process.env.NOTIFY_EMAIL;
    if (notifyTo) {
      try {
        const when = whenStr(a.start);
        await sendMail({
          to: notifyTo,
          from: process.env.NOTIFY_FROM || notifyTo,
          subject: `${q.qualified ? 'New booking' : '⚠ REVIEW'} — ${who} — ${when}`,
          text: internalEmailText(a, q, when, q.qualified, meetLink, eventLink),
        });
      } catch (mailErr) {
        console.error('[book] internal notification email failed:', mailErr?.response?.data || mailErr);
      }
    } else {
      console.warn('[book] NOTIFY_EMAIL not set — skipping internal notification email');
    }

    return res.status(200).json({
      status: q.qualified ? 'confirmed' : 'pending',
      meetLink,
      start: a.start,
      end: v.end,
      eventId: event.data.id,
    });
  } catch (err) {
    console.error('[book] error:', err?.response?.data || err);
    return res.status(500).json({ error: 'Booking service error', details: err.message });
  }
}
