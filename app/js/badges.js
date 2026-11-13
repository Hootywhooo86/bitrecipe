// Levels and badges. XP comes from cooking (+50 per finished recipe) and a
// few small actions; badges unlock from stats. Both feed 128bitlife later
// through the family event outbox.

export const XP = { cook: 50, save: 10, version: 15, grocery: 5, write: 25 };

export const LEVELS = ['Kitchen Newbie', 'Prep Cook', 'Line Cook', 'Sous Chef', 'Head Chef', 'Executive Chef', 'Pixel Legend'];

export function levelOf(xp = 0) {
  // each level needs a bit more: 0, 100, 250, 450, 700, 1000, 1400 ...
  let need = 100, lvl = 0, floor = 0;
  while (xp >= floor + need) { floor += need; lvl++; need += 50; }
  return { level: lvl + 1, title: LEVELS[Math.min(lvl, LEVELS.length - 1)], into: xp - floor, need };
}

export const BADGES = [
  { id: 'first-cook', name: 'First Quest', desc: 'Cook your first recipe', test: (s) => s.cooks >= 1 },
  { id: 'cook-5', name: 'Regular', desc: 'Cook 5 times', test: (s) => s.cooks >= 5 },
  { id: 'cook-25', name: 'Kitchen Hero', desc: 'Cook 25 times', test: (s) => s.cooks >= 25 },
  { id: 'collector', name: 'Collector', desc: 'Save 10 recipes', test: (s) => s.saved >= 10 },
  { id: 'author', name: 'Original Chef', desc: 'Write your own recipe', test: (s) => s.written >= 1 },
  { id: 'ai', name: 'AI Sous Chef', desc: 'Make a recipe with the AI chef', test: (s) => s.ai >= 1 },
  { id: 'remix', name: 'Remixer', desc: 'Make your own version of a recipe', test: (s) => s.versions >= 1 },
  { id: 'pinner', name: 'Pin Master', desc: 'Get a recipe from a Pinterest board', test: (s) => s.pins >= 1 },
  { id: 'tiktok', name: 'Scroll Chef', desc: 'Import a TikTok or Reel', test: (s) => s.videos >= 1 },
  { id: 'timers', name: 'Timer Lord', desc: 'Run 10 timers', test: (s) => s.timers >= 10 },
  { id: 'shopper', name: 'List Maker', desc: 'Build a grocery list', test: (s) => s.lists >= 1 },
  { id: 'multitask', name: 'Multitasker', desc: 'Cook a recipe with 3 tracks', test: (s) => s.threeTrack >= 1 },
];

export function statsFrom(db) {
  const st = db.stats || {};
  return {
    cooks: db.recipes.reduce((a, r) => a + (r.cooked || 0), 0) + (st.deletedCooks || 0),
    saved: db.recipes.filter((r) => !r.sample).length,
    versions: db.recipes.filter((r) => r.parent).length,
    pins: db.recipes.filter((r) => r.source?.via === 'pinterest').length,
    videos: db.recipes.filter((r) => ['tiktok', 'instagram'].includes(r.source?.platform) && !r.sample).length,
    timers: st.timers || 0,
    lists: st.lists || 0,
    threeTrack: st.threeTrack || 0,
    written: st.written || 0,
    ai: db.recipes.filter((r) => r.source?.platform === 'ai').length,
  };
}

// Returns badges newly earned since last check (and records them).
export function checkBadges(db) {
  db.badges ||= {};
  const s = statsFrom(db);
  const fresh = BADGES.filter((b) => !db.badges[b.id] && b.test(s));
  fresh.forEach((b) => { db.badges[b.id] = Date.now(); });
  return fresh;
}
