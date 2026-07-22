/* ===================================================================
   GET /api/availability
   -------------------------------------------------------------------
   Reads busy times straight from the connected Google Calendar
   (freebusy), then returns only the open 30-min weekday slots inside
   working hours. Response:

     { tz:'America/New_York', generatedAt:ISO,
       days:[ { date, label, dow, slots:[{start,end,time}] } ] }
   ================================================================ */

import { getCalendar, CALENDAR_ID, cors } from '../lib/google.js';
import { buildAvailability, CONFIG } from '../lib/slots.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const now = new Date();
    const timeMax = new Date(now.getTime() + (CONFIG.WINDOW_DAYS + 1) * 24 * 3600 * 1000);

    const calendar = getCalendar();
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: CONFIG.TZ,
        items: [{ id: CALENDAR_ID() }],
      },
    });

    const cal = fb.data.calendars?.[CALENDAR_ID()] || {};
    if (cal.errors?.length) {
      console.error('[availability] freebusy error:', cal.errors);
      return res.status(500).json({ error: 'Calendar read failed', details: cal.errors });
    }

    const busy = (cal.busy || []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    const days = buildAvailability(now, busy);

    // Small cache so a page refresh doesn't hammer the API, but stays fresh.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ tz: CONFIG.TZ, generatedAt: now.toISOString(), days });
  } catch (err) {
    console.error('[availability] error:', err);
    return res.status(500).json({ error: 'Availability service error', details: err.message });
  }
}
