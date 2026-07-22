/* ===================================================================
   ORBIS SCHEDULE — slot engine (pure, no I/O)
   -------------------------------------------------------------------
   All availability math lives here so it can be unit-tested without
   touching Google. The studio is on EASTERN TIME (Washington, DC),
   which observes daylight saving — so we resolve the UTC⇄local offset
   per-instant via Intl instead of assuming a fixed offset.
   ================================================================ */

export const CONFIG = {
  TZ: 'America/New_York',   // Eastern Time — handles EDT/EST automatically
  WORK_START_MIN: 10 * 60,  // 10:00 local
  WORK_END_MIN: 18 * 60,    // 18:00 local (last 30-min slot starts 17:30)
  SLOT_MIN: 30,             // meeting length
  BUFFER_MIN: 15,           // padding kept clear around existing events
  MIN_NOTICE_MIN: 120,      // earliest bookable = now + 2h (same-day allowed)
  WINDOW_DAYS: 14,          // how far ahead the calendar opens
  WORK_DOWS: [1, 2, 3, 4, 5], // Mon–Fri (0 = Sun)
};

const pad = (n) => String(n).padStart(2, '0');
const DOW_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* Read an instant's local wall-clock (Eastern) via Intl. */
function localParts(instant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.TZ, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const x of dtf.formatToParts(instant)) p[x.type] = x.value;
  const hour = p.hour === '24' ? 0 : parseInt(p.hour, 10);
  return {
    y: +p.year, m: +p.month, day: +p.day,
    dow: DOW_MAP[p.weekday],
    minutes: hour * 60 + parseInt(p.minute, 10),
  };
}

/* Minutes that local time is ahead of UTC at a given instant
   (negative — Eastern is behind UTC). */
function offsetMin(instant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const x of dtf.formatToParts(instant)) p[x.type] = x.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return (asUTC - instant.getTime()) / 60000;
}

/* The UTC instant for a given Eastern wall date + minute-of-day.
   One correction pass resolves the offset; our work hours (10–18) are
   far from the 02:00 DST transition, so a single pass is exact here. */
function localInstant(y, m, day, minuteOfDay) {
  const hh = Math.floor(minuteOfDay / 60);
  const mm = minuteOfDay % 60;
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  const off = offsetMin(new Date(guess));
  return new Date(guess - off * 60000);
}

const YMD = (y, m, day) => `${y}-${pad(m)}-${pad(day)}`;
const HHMM = (minuteOfDay) => `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;

/* Does [s,e) intersect any busy interval, once each busy block is
   padded by BUFFER_MIN on both sides? */
function collides(s, e, busy) {
  const bufMs = CONFIG.BUFFER_MIN * 60000;
  for (const b of busy) {
    const bs = b.start.getTime() - bufMs;
    const be = b.end.getTime() + bufMs;
    if (s.getTime() < be && e.getTime() > bs) return true;
  }
  return false;
}

/**
 * Generate available slots grouped by local (Eastern) calendar day.
 * @param {Date}   now   current instant (injectable for tests)
 * @param {Array}  busy  [{start:Date, end:Date}] busy intervals
 * @returns {Array} [{ date:'YYYY-MM-DD', label:'Wed · Jul 22', dow, slots:[{start,end,time}] }]
 */
export function buildAvailability(now, busy = []) {
  const earliest = new Date(now.getTime() + CONFIG.MIN_NOTICE_MIN * 60000);
  const windowEnd = new Date(now.getTime() + CONFIG.WINDOW_DAYS * 24 * 3600 * 1000);
  const today = localParts(now);

  const days = [];
  for (let offset = 0; offset <= CONFIG.WINDOW_DAYS; offset++) {
    // Anchor at 16:00 UTC of the target date (always mid-day Eastern, same
    // calendar day in EST or EDT), then read the local date back.
    const anchor = new Date(Date.UTC(today.y, today.m - 1, today.day + offset, 16, 0));
    const p = localParts(anchor);
    if (!CONFIG.WORK_DOWS.includes(p.dow)) continue;

    const slots = [];
    for (let t = CONFIG.WORK_START_MIN; t + CONFIG.SLOT_MIN <= CONFIG.WORK_END_MIN; t += CONFIG.SLOT_MIN) {
      const s = localInstant(p.y, p.m, p.day, t);
      const e = localInstant(p.y, p.m, p.day, t + CONFIG.SLOT_MIN);
      if (s < earliest) continue;      // too soon (respects min notice)
      if (e > windowEnd) continue;     // beyond the 14-day window
      if (collides(s, e, busy)) continue;
      slots.push({ start: s.toISOString(), end: e.toISOString(), time: HHMM(t) });
    }
    if (slots.length) {
      days.push({
        date: YMD(p.y, p.m, p.day),
        label: `${WEEKDAY[p.dow]} · ${MONTH[p.m - 1]} ${p.day}`,
        dow: p.dow,
        slots,
      });
    }
  }
  return days;
}

/**
 * Server-side validation that a requested start is a real, bookable slot
 * boundary (defends against tampered/expired POSTs). Returns {ok, end?, reason?}.
 */
export function validateSlot(startISO, now) {
  const start = new Date(startISO);
  if (isNaN(start.getTime())) return { ok: false, reason: 'invalid start' };

  const earliest = new Date(now.getTime() + CONFIG.MIN_NOTICE_MIN * 60000);
  const windowEnd = new Date(now.getTime() + CONFIG.WINDOW_DAYS * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + CONFIG.SLOT_MIN * 60000);

  if (start < earliest) return { ok: false, reason: 'too soon' };
  if (end > windowEnd) return { ok: false, reason: 'outside booking window' };

  const p = localParts(start);
  if (!CONFIG.WORK_DOWS.includes(p.dow)) return { ok: false, reason: 'not a work day' };
  if (p.minutes < CONFIG.WORK_START_MIN || p.minutes + CONFIG.SLOT_MIN > CONFIG.WORK_END_MIN) {
    return { ok: false, reason: 'outside work hours' };
  }
  if ((p.minutes - CONFIG.WORK_START_MIN) % CONFIG.SLOT_MIN !== 0) {
    return { ok: false, reason: 'not on a slot boundary' };
  }
  return { ok: true, end: end.toISOString() };
}
