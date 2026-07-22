/* ===================================================================
   ORBIS SCHEDULE — lead qualification
   -------------------------------------------------------------------
   Decides whether a booking request auto-confirms or is held for a
   human to review. Pure function, easy to tune. Edit RULES / THRESHOLD
   to change what "qualified" means — nothing else needs to change.

   Returns: { qualified:boolean, score:number, reasons:[], flags:[] }
     reasons → positive signals that counted toward qualification
     flags   → concerns that pushed it to manual review
   ================================================================ */

// In-ICP client types (developers, brokers, design & marketing firms).
const ICP_ROLES = [
  'developer', 'broker', 'real estate', 'architect', 'design firm',
  'designer', 'interior', 'marketing', 'agency', 'brand', 'studio',
  'hospitality', 'hotel', 'investor', 'owner',
];

// Timelines that indicate an active, fundable project.
const ACTIVE_TIMELINES = ['immediately', '1-3', '1–3', '3-6', '3–6'];

// Real project categories.
const REAL_PROJECT_TYPES = ['residential', 'commercial', 'mixed', 'hospitality'];

// Priority growth markets (DC metro + coastal US + existing Caribbean base).
const TARGET_MARKETS = ['washington', 'dc', 'new york', 'miami', 'south florida', 'florida', 'puerto rico', 'caribbean'];

// Anything here in a free-text field forces review.
const SPAM_HINTS = ['seo service', 'guest post', 'backlink', 'cheap', 'crypto', 'loan offer', 'http://', 'https://'];

const THRESHOLD = 4; // need at least this many points AND zero hard-flags

const lc = (v) => String(v || '').toLowerCase().trim();
const has = (v) => lc(v).length > 0;

export function qualify(a = {}) {
  const reasons = [];
  const flags = [];
  let score = 0;

  // --- Hard requirement: a real email -------------------------------
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lc(a.email));
  if (!emailOk) flags.push('no valid email');

  // --- Positive signals --------------------------------------------
  const roleText = `${lc(a.role)} ${lc(a.company)}`;
  if (ICP_ROLES.some((r) => roleText.includes(r))) {
    score += 2; reasons.push('client type is in target market');
  } else if (has(a.company)) {
    score += 1; reasons.push('named company/organization');
  }

  if (REAL_PROJECT_TYPES.some((p) => lc(a.projectType).includes(p))) {
    score += 1; reasons.push('defined project type');
  }

  if (a.region && TARGET_MARKETS.some((t) => lc(a.region).includes(t))) {
    score += 1; reasons.push('priority growth market');
  }

  if (has(a.size)) { score += 1; reasons.push('project size given'); }
  if (has(a.location)) { score += 1; reasons.push('location given'); }

  if (Array.isArray(a.services) && a.services.length > 0) {
    score += 1; reasons.push('services identified');
  }

  if (ACTIVE_TIMELINES.some((t) => lc(a.timeline).includes(t))) {
    score += 2; reasons.push('active timeline');
  }

  // A referral is a strong trust signal.
  if (has(a.referral) && !/^(google|search|instagram|ad|other)$/i.test(lc(a.referral))) {
    score += 1; reasons.push('warm referral');
  }

  // --- Hard flags (force review regardless of score) ---------------
  if (!has(a.projectType)) flags.push('no project type');
  if (!has(a.company) && !ICP_ROLES.some((r) => lc(a.role).includes(r))) {
    flags.push('no company / unclear who they are');
  }
  if (/(just )?(exploring|curious|browsing|not sure|maybe someday|no timeline)/i.test(lc(a.timeline))
      && !has(a.size)) {
    flags.push('exploratory, no defined project');
  }
  const blob = `${lc(a.notes)} ${lc(a.company)} ${lc(a.referral)}`;
  if (SPAM_HINTS.some((s) => blob.includes(s))) flags.push('possible spam/solicitation');

  const qualified = emailOk && flags.length === 0 && score >= THRESHOLD;
  return { qualified, score, reasons, flags };
}

export const QUALIFY_META = { THRESHOLD, ICP_ROLES, ACTIVE_TIMELINES, REAL_PROJECT_TYPES, TARGET_MARKETS };
