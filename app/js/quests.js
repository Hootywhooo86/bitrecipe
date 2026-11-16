// Daily quests and cooking streaks.
//
// Every day brings 3 quests (the same 3 on every device, picked from the
// date). Progress counts actions done since the day started: the app calls
// bump('cook') etc. and counters live in db.stats as did_<name>, so they sync
// and merge like the other stats. A streak is days in a row with a cook.

export const QUEST_XP_ALL = 50; // bonus for finishing all three

const COOK = [
  { id: 'cook1', k: 'cook', n: 1, xp: 30, text: 'Cook any recipe' },
  { id: 'firstcook', k: 'firstcook', n: 1, xp: 40, text: 'Cook a recipe you’ve never made' },
  { id: 'quick', k: 'quickcook', n: 1, xp: 30, text: 'Cook something that takes 30 min or less' },
  { id: 'bigcook', k: 'bigcook', n: 1, xp: 35, text: 'Cook a recipe with 2 or more tracks' },
];
const OTHER = [
  { id: 'rate', k: 'rate', n: 1, xp: 20, text: 'Rate a recipe' },
  { id: 'note', k: 'note', n: 1, xp: 20, text: 'Leave a note for next time' },
  { id: 'save', k: 'save', n: 1, xp: 20, text: 'Save a new recipe' },
  { id: 'save2', k: 'save', n: 2, xp: 30, text: 'Save 2 new recipes' },
  { id: 'plan', k: 'plan', n: 3, xp: 30, text: 'Plan 3 meals in the meal planner' },
  { id: 'list', k: 'list', n: 1, xp: 15, text: 'Add a recipe to your grocery list' },
  { id: 'timer', k: 'timer', n: 2, xp: 20, text: 'Run 2 timers' },
  { id: 'ai', k: 'ai', n: 1, xp: 25, text: 'Make a recipe with the AI chef or a photo' },
  { id: 'swap', k: 'swap', n: 1, xp: 15, text: 'Look up an ingredient swap' },
];

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return today(d); };

function seeded(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function questsFor(day) {
  const rnd = seeded('bitrecipe-' + day);
  const cook = COOK[Math.floor(rnd() * COOK.length)];
  const pool = [...OTHER];
  const picks = [];
  while (picks.length < 2) picks.push(...pool.splice(Math.floor(rnd() * pool.length), 1));
  // no two quests counting the same thing
  if (picks[0].k === picks[1].k) picks[1] = pool.find((q) => q.k !== picks[0].k);
  return [cook, ...picks];
}

const did = (db, k) => db.stats?.['did_' + k] || 0;

// Today's quests with progress; starts a new day's set when the date changes.
export function questState(db) {
  const day = today();
  if (db.quests?.day !== day) {
    const base = {};
    for (const q of [...COOK, ...OTHER]) base[q.k] = did(db, q.k);
    db.quests = { day, base, claimed: {}, bonus: false };
  }
  const list = questsFor(day).map((q) => {
    const got = Math.min(q.n, did(db, q.k) - (db.quests.base[q.k] ?? did(db, q.k)));
    return { ...q, got, done: got >= q.n, claimed: !!db.quests.claimed[q.id] };
  });
  return { list, bonus: db.quests.bonus };
}

// Count an action; returns quests that just finished (XP is given by the caller).
export function bump(db, k, n = 1) {
  db.stats ||= {};
  questState(db); // make sure today's baseline exists before counting
  db.stats['did_' + k] = did(db, k) + n;
  const { list } = questState(db);
  const fresh = list.filter((q) => q.done && !q.claimed);
  fresh.forEach((q) => { db.quests.claimed[q.id] = true; db.stats.questsDone = (db.stats.questsDone || 0) + 1; });
  let all = false;
  if (fresh.length && list.every((q) => q.done) && !db.quests.bonus) { db.quests.bonus = true; all = true; }
  return { fresh, all };
}

// Streak: call when a recipe is cooked. Returns the new length if it grew today.
export function cookedToday(db) {
  const s = (db.streak ||= { n: 0, best: 0, last: '' });
  const d = today();
  if (s.last === d) return 0;
  s.n = s.last === yesterday() ? s.n + 1 : 1;
  s.last = d;
  s.best = Math.max(s.best || 0, s.n);
  return s.n;
}

// Days in a row, still alive if you cooked today or yesterday.
export function streakNow(db) {
  const s = db.streak;
  if (!s || !s.n) return 0;
  return s.last === today() || s.last === yesterday() ? s.n : 0;
}

export const STREAK_BONUS = { 3: 30, 7: 75, 14: 150, 30: 300 };
