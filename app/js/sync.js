// Sync with the 128bit server (table bitrecipe_items, see supabase/bitrecipe-sync.sql).
//
// Every recipe, the grocery list and a "profile" (XP, badges, stats, colours,
// prefs, Pinterest boards) is one item. Changes are spotted by hashing each
// item, so no screen needs to know about sync. Rules:
//  - pull first (by server time), then push what changed here;
//  - newest edit wins per item; the server also refuses older overwrites;
//  - XP / badges / stats merge (highest / union) so no device loses progress;
//  - deleting a recipe sends a tombstone so it disappears everywhere.

import { api, signedIn } from './account.js';

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ':' + str.length;
}

const profileOf = (db) => ({
  xp: db.xp || 0,
  badges: db.badges || {},
  stats: db.stats || {},
  theme: db.theme,
  prefs: { system: db.prefs.system, view: db.prefs.view, motion: db.prefs.motion },
  pinterest: db.pinterest || { boards: [] },
  fridge: db.fridge || null,
  aiModels: db.ai?.models || {},
  familyName: db.family?.name || '',
});

function localItems(db) {
  const m = new Map();
  for (const r of db.recipes) m.set(`recipe:${r.id}`, { kind: 'recipe', id: r.id, data: r });
  m.set('grocery:list', { kind: 'grocery', id: 'list', data: db.grocery });
  m.set('profile:me', { kind: 'profile', id: 'me', data: profileOf(db) });
  return m;
}

function state(db) {
  db.sync ||= {};
  db.sync.synced ||= {}; // key -> hash both sides agreed on
  db.sync.stamp ||= {};  // key -> { h, t } when this device last changed it
  return db.sync;
}

// Call after any local change: records when each item changed.
export function noteChanges(db) {
  const st = state(db);
  const now = Date.now();
  const local = localItems(db);
  for (const [key, it] of local) {
    const h = hash(JSON.stringify(it.data));
    if (st.stamp[key]?.h !== h) st.stamp[key] = { h, t: now };
  }
  for (const key of Object.keys(st.synced)) {
    if (!local.has(key) && !st.stamp[key]?.del) st.stamp[key] = { del: true, t: now };
  }
}

function applyRemote(db, row, localNewer = false) {
  const d = row.data;
  if (row.kind === 'recipe') {
    const i = db.recipes.findIndex((r) => r.id === row.id);
    if (row.deleted) { if (i >= 0) db.recipes.splice(i, 1); return; }
    if (i >= 0) db.recipes[i] = d; else db.recipes.unshift(d);
  } else if (row.kind === 'grocery' && d) {
    db.grocery = d;
  } else if (row.kind === 'profile' && d) {
    db.xp = Math.max(db.xp || 0, d.xp || 0);
    db.badges = { ...(d.badges || {}), ...(db.badges || {}) };
    const stats = { ...(db.stats || {}) };
    for (const [k, v] of Object.entries(d.stats || {})) stats[k] = Math.max(stats[k] || 0, v || 0);
    db.stats = stats;
    if (localNewer) return; // keep this phone's newer colours / prefs / boards
    if (d.theme) db.theme = d.theme;
    if (d.fridge) db.fridge = d.fridge;
    if (d.aiModels) { db.ai ||= { engine: 'gemini', diet: '', servings: 4, time: '', useFridge: false }; db.ai.models = d.aiModels; }
    if (d.familyName) { db.family ||= { books: [], recipes: {}, cursors: {}, name: '' }; db.family.name ||= d.familyName; }
    if (d.prefs) Object.assign(db.prefs, d.prefs);
    if (d.pinterest) {
      const mine = db.pinterest?.boards || [];
      const boards = (d.pinterest.boards || []).map((b) => {
        const m = mine.find((x) => x.feed === b.feed);
        return m ? { ...b, seen: [...new Set([...(b.seen || []), ...(m.seen || [])])].slice(-500), last: Math.max(b.last || 0, m.last || 0) } : b;
      });
      db.pinterest = { boards };
    }
  }
}

let running = null;

// One full sync. Returns { pulled, pushed }.
export function syncNow(db, { save } = {}) {
  if (!signedIn()) return Promise.resolve({ pulled: 0, pushed: 0 });
  running ||= run(db, save).finally(() => { running = null; });
  return running;
}

async function run(db, save) {
  const st = state(db);
  noteChanges(db);
  let pulled = 0, pushed = 0;

  // ---- pull everything changed on the server since last time
  for (let page = 0; page < 40; page++) {
    const since = st.cursor ? `&updated_at=gt.${encodeURIComponent(st.cursor)}` : '';
    const rows = await api(`bitrecipe_items?select=kind,id,data,deleted,modified,updated_at${since}&order=updated_at.asc&limit=200`);
    for (const row of rows) {
      const key = `${row.kind}:${row.id}`;
      const cur = localItems(db).get(key);
      const curHash = cur ? hash(JSON.stringify(cur.data)) : null;
      const neverSynced = !(key in st.synced);
      const localChanged = st.synced[key] !== (curHash ?? undefined) && (cur || st.stamp[key]?.del);
      const localNewer = localChanged && !neverSynced && (st.stamp[key]?.t || 0) > (row.modified || 0);
      if (localNewer && row.kind !== 'profile') { st.cursor = row.updated_at; continue; } // ours is newer: pushed below
      applyRemote(db, row, localNewer);
      pulled++;
      const after = localItems(db).get(key);
      const rowHash = row.deleted ? undefined : hash(JSON.stringify(row.data));
      if (row.deleted) { delete st.synced[key]; delete st.stamp[key]; }
      else {
        st.synced[key] = rowHash;
        const h = after ? hash(JSON.stringify(after.data)) : null;
        // a merged profile that now differs from the server's gets pushed back
        st.stamp[key] = h === rowHash ? { h, t: row.modified || 0 } : { h, t: Date.now() };
      }
      st.cursor = row.updated_at;
    }
    if (rows.length < 200) break;
  }
  if (pulled) save?.();

  // ---- push what changed here
  const local = localItems(db);
  const out = [];
  for (const [key, it] of local) {
    const h = hash(JSON.stringify(it.data));
    if (st.synced[key] === h) continue;
    out.push({ key, h, row: { kind: it.kind, id: it.id, data: it.data, deleted: false, modified: st.stamp[key]?.t || Date.now() } });
  }
  for (const [key, s] of Object.entries(st.stamp)) {
    if (s.del && !local.has(key)) {
      const [kind, ...rest] = key.split(':');
      out.push({ key, del: true, row: { kind, id: rest.join(':'), deleted: true, modified: s.t } });
    }
  }
  for (let i = 0; i < out.length; i += 50) {
    const batch = out.slice(i, i + 50);
    await api('rpc/bitrecipe_push', { method: 'POST', body: { items: batch.map((b) => b.row) } });
    for (const b of batch) {
      if (b.del) { delete st.synced[b.key]; delete st.stamp[b.key]; } else st.synced[b.key] = b.h;
    }
    pushed += batch.length;
  }

  st.last = Date.now();
  st.error = null;
  save?.();
  return { pulled, pushed };
}

// Family feed (Tracker's timeline): only when the person switched sharing on,
// and only events from after that moment.
export async function pushFeed(db) {
  if (!signedIn() || !db.prefs.shareFeed) return 0;
  const st = state(db);
  const from = db.prefs.shareFeedFrom || Date.now();
  st.sentEvents ||= [];
  const fresh = db.events.filter((e) => e.id && Date.parse(e.at) >= from && !st.sentEvents.includes(e.id)).slice(0, 200);
  if (!fresh.length) return 0;
  await api('rpc/log_events', { method: 'POST', body: { events: fresh.map((e) => ({ id: e.id, app: 'bitrecipe', type: e.type, at: Date.parse(e.at), data: e.payload || {} })) } });
  st.sentEvents = [...st.sentEvents, ...fresh.map((e) => e.id)].slice(-1000);
  return fresh.length;
}

// Forget what was synced (after signing out or switching accounts).
export function resetSync(db) {
  db.sync = {};
}
