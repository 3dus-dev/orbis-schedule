/* ===================================================================
   POST /api/book
   -------------------------------------------------------------------
   Body: { start, name, email, phone, company, role, referral,
           projectType, size, location, services[], timeline, notes }

   Qualified lead   → confirmed event + Google Meet + invite to client.
   Unqualified lead → tentative "⚠ REVIEW" hold on the calendar, no
                      invite sent; client is told the request is pending.

   Response:
     { status:'confirmed', meetLink, start, end }
     { status:'pending',   start, end }         // held for human review
   ================================================================ */

import { getCalendar, CALENDAR_ID, cors } from '../lib/google.js';
import { validateSlot, CONFIG } from '../lib/slots.js';
import { qualify, QUALIFY_META } from '../lib/qualify.js';

const esc = (s) => String(s == null ? '' : s).trim();

function describe(a, q) {
  const line = (label, val) => `${label}: ${val || '—'}`;
  return [
    q.qualified ? 'ORBIS · CONFIRMED PITCH MEETING' : '⚠ ORBIS · PENDING REVIEW — do not treat as confirmed',
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
    '',
    '— qualification ————————————',
    `score: ${q.score} (threshold ${QUALIFY_META.THRESHOLD})`,
    `signals: ${q.reasons.join('; ') || 'none'}`,
    `flags: ${q.flags.join('; ') || 'none'}`,
  ].join('\n');
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
      description: describe(a, q),
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
