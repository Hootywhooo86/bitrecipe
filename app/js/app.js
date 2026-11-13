// bitrecipe app shell: library -> import -> review -> recipe -> cook mode.
import { SAMPLES } from './samples.js';
import { importAnything, parseIngredientLine, linkSteps, tokensToMarkers, markersToTokens, guessEquipment, timerFrom } from './parse.js';
import { amountText, itemText, minutesText } from './units.js';
import { renderTrackMap, renderList, renderLegend, renderText, laneIndex, laneName, maxParallel, esc } from './trackmap.js';
import { PRESETS, TOKENS, applyTheme, contrastReport, fixContrast } from './theme.js';
import { logoSvg } from './logo.js';
import { resolveBoard, syncBoards } from './pinterest.js';
import { buildList, listAsText } from './grocery.js';
import { chef, flame, trophy } from './sprites.js';
import { XP, levelOf, BADGES, checkBadges } from './badges.js';
import { makePhoto, PHOTO_VERSION } from './photo.js';
import { VERSION } from './version.js';
import { signIn, signUp, signOut, resetPassword, signedIn, accountEmail, api, callFunction } from './account.js';
import { syncNow, noteChanges, pushFeed, resetSync } from './sync.js';
import { familyRecipes, findFamilyRecipe, refreshBooks, createBook, joinBook, leaveBook, shareToBook, unshare, pullBooks } from './family.js';
import { recipeCard, plainStep } from './card.js';
import { createVoice } from './voice.js';
import { keyOf } from './grocery.js';

// ---------- storage ----------
const KEY = 'bitrecipe.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const db = load() || { recipes: structuredClone(SAMPLES), theme: { preset: 'tomato', custom: null }, prefs: { system: 'orig', view: 'map' }, events: [], xp: 0 };
const store = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('Storage full — could not save'); } };
// Every save also tells sync (shortly after) that something changed.
let noteT, syncT;
const save = () => {
  store();
  if (!signedIn()) return;
  clearTimeout(noteT); noteT = setTimeout(() => { noteChanges(db); store(); }, 1200);
  clearTimeout(syncT); syncT = setTimeout(() => runSync(), 5000);
};
save();

// Family event outbox (shared 128bit family_events feed; synced once accounts land).
function emit(type, payload) {
  db.events.push({ id: `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, type, app: 'bitrecipe', at: new Date().toISOString(), payload });
  db.events = db.events.slice(-200);
  save();
}

// ---------- native bridge (Android) ----------
const native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor : null;
const BitNative = native ? native.registerPlugin('BitNative') : null;
async function keepAwake(on) {
  try {
    if (BitNative) await BitNative.keepAwake({ on });
    else if (on && navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* screen may still sleep; not fatal */ }
}
let wakeLock = null;

// ---------- state for the open recipe ----------
const session = { draft: null, flags: [], servings: {}, done: {}, have: {}, cook: null, pendingInput: '' };
const theme = () => db.theme.custom || PRESETS[db.theme.preset] || PRESETS.tomato;
// Status/navigation bars take the theme colour, with dark or light icons to match.
function paint(t) {
  applyTheme(t);
  BitNative?.setBars({ color: t.bg, light: document.documentElement.dataset.light === '1' }).catch(() => {});
}
paint(theme());

const $app = document.getElementById('app');
const go = (hash) => { location.hash = hash; };
const byId = (id) => db.recipes.find((r) => r.id === id) || (db.family ? findFamilyRecipe(db, id) : null);
const ctxFor = (r) => {
  const servings = session.servings[r.id] || r.servings;
  return { factor: servings / r.servings, system: db.prefs.system, done: (session.done[r.id] ||= new Set()), servings };
};

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

// ---------- 128bit account sync ----------
async function runSync(manual = false) {
  if (!signedIn()) return;
  session.syncing2 = true;
  if (location.hash.startsWith('#/settings')) rerender();
  try {
    const { pulled, pushed } = await syncNow(db, { save: store });
    await pushFeed(db).catch(() => {});
    let famPulled = 0;
    try { await refreshBooks(db); famPulled = await pullBooks(db); } catch { /* family tables may not exist yet */ }
    if (famPulled && (location.hash === '' || location.hash === '#/')) rerender();
    store();
    if (pulled) { paint(theme()); if (!session.cook && !['#/review'].includes(location.hash) && !location.hash.startsWith('#/edit')) rerender(); }
    if (manual) toast(pulled || pushed ? `Synced · ${pulled} in, ${pushed} out` : 'Already up to date');
  } catch (e) {
    db.sync ||= {}; db.sync.error = e.message; store();
    if (manual) toast(e.message);
  }
  session.syncing2 = false;
  if (location.hash.startsWith('#/settings')) rerender();
}

// ---------- XP, levels, badges ----------
db.stats ||= {};
db.grocery ||= { entries: [], manual: [], checked: {} };
function award(xp, why) {
  const before = levelOf(db.xp || 0).level;
  db.xp = (db.xp || 0) + xp;
  const after = levelOf(db.xp);
  if (xp) emit('xp.earned', { xp, why });
  if (after.level > before) { celebrate('LEVEL UP!', `LV ${after.level} · ${after.title}`, true); emit('level.up', { level: after.level, title: after.title }); }
  badgeCheck();
  save();
}
function badgeCheck() {
  for (const b of checkBadges(db)) { celebrate('BADGE UNLOCKED', b.name); emit('badge.unlocked', { badge: b.id, name: b.name }); }
  save();
}
const celebrations = [];
function celebrate(head, body, big = false) {
  celebrations.push({ head, body, big });
  if (celebrations.length === 1) showCelebration();
}
function showCelebration() {
  const c = celebrations[0];
  if (!c) return;
  const el = document.createElement('div');
  el.className = `celebrate${c.big ? ' big' : ''}`;
  el.innerHTML = `${trophy(c.big ? 64 : 28)}<div><b class="px">${esc(c.head)}</b><span>${esc(c.body)}</span></div>`;
  document.body.append(el);
  if (c.big) confetti();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); celebrations.shift(); showCelebration(); }, 350); }, c.big ? 2600 : 2200);
}
function levelBar() {
  const L = levelOf(db.xp || 0);
  const pct = Math.round((L.into / L.need) * 100);
  const got = Object.keys(db.badges || {}).length;
  return `<button class="panel lvl" data-go="#/badges"><div class="row" style="justify-content:space-between"><span class="px lvtag">LV ${L.level}</span><b class="grow">${esc(L.title)}</b><span class="small muted">${trophy(16)} ${got}/${BADGES.length}</span></div>
    <div class="xpbar"><i style="width:${pct}%"></i></div><span class="small muted">${L.into}/${L.need} XP to next level · ${db.xp || 0} total</span></button>`;
}

// Photos: made once from the recipe's image link, stored inline (~30 KB JPEG).
// Old pixel-art photos are swapped for real ones when the link still works.
const photoQueue = new Set();
async function ensurePhoto(r) {
  if (!r || !r.image || photoQueue.has(r.id) || r.photoFailed || (r.photo && r.photoV === PHOTO_VERSION)) return;
  photoQueue.add(r.id);
  const data = await makePhoto(r.image);
  photoQueue.delete(r.id);
  const live = byId(r.id);
  if (!live) return;
  if (data) { live.photo = data; live.photoV = PHOTO_VERSION; } else if (!live.photo) live.photoFailed = true; else live.photoV = PHOTO_VERSION; // keep the old one if the link died
  save();
  if (data && (location.hash === '' || location.hash === '#/' || location.hash === '#/r/' + r.id)) rerender();
}
const photoTag = (r, cls) => r.photo ? `<img class="${cls}" src="${r.photo}" alt="">` : '';

// Share text out (native share sheet, else clipboard, else a copy box).
async function shareOut(text, title) {
  if (BitNative) { try { await BitNative.shareText({ text, title }); return; } catch { /* fall through */ } }
  try { await navigator.clipboard.writeText(text); toast('Copied — paste it anywhere'); return; } catch { /* fall through */ }
  const box = document.createElement('div');
  box.className = 'cook';
  box.innerHTML = `<div class="bar"><button class="icon-btn" aria-label="Close">✕</button><span class="px small">COPY THIS</span></div><textarea class="field" style="flex:1;margin-top:12px">${esc(text)}</textarea>`;
  box.querySelector('button').onclick = () => box.remove();
  document.body.append(box);
  box.querySelector('textarea').select();
}

function importReport(r) {
  return [
    `bitrecipe import report · v${VERSION}`,
    `Title: ${r.title}`,
    `Source: ${r.source?.platform || 'text'} ${r.source?.url || ''} ${r.source?.creator ? '(' + r.source.creator + ')' : ''}`,
    r.importDebug?.input ? `\n--- What was shared/pasted ---\n${r.importDebug.input}` : '',
    `\n--- Ingredient lines found ---\n${(r.importDebug?.ingredientLines || []).join('\n') || '(none)'}`,
    `\n--- Step lines found ---\n${(r.importDebug?.stepLines || []).join('\n') || '(none)'}`,
    `\n--- What bitrecipe made ---`,
    `Tracks: ${r.lanes.map((l) => l.id + '=' + l.name).join(', ')}`,
    ...r.ingredients.map((i) => `• ${i.qty ?? '??'}${i.qty2 ? '-' + i.qty2 : ''} ${i.unit || ''} | ${i.item}${i.prep ? ' | ' + i.prep : ''}${i.loose ? ' | ' + i.loose : ''}`),
    ...r.steps.map((st, k) => `${k + 1}. [${st.lane}${st.merges?.length ? ' ⤵' + st.merges.join('') : ''}]${st.timer ? ' ⏱' + st.timer.min + 'm' : ''} ${st.text}`),
    `\n--- What went wrong (write here) ---\n`,
  ].filter(Boolean).join('\n');
}

// ---------- updates ----------
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate(manual = false) {
  if (VERSION === 'dev' && !manual) return;
  try {
    const res = await fetch('https://api.github.com/repos/Hootywhooo86/bitrecipe/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    const rel = await res.json();
    const latest = (rel.tag_name || '').replace(/^v/, '');
    const apk = rel.assets?.find((a) => a.name.endsWith('.apk'))?.browser_download_url;
    session.update = latest && apk && (VERSION === 'dev' || newer(latest, VERSION)) ? { version: latest, url: apk } : null;
    db.prefs.updateChecked = Date.now(); save();
    if (manual) toast(session.update ? `v${latest} is ready to download` : 'You have the newest version');
  } catch { if (manual) toast('Couldn’t check for updates'); }
  if (['', '#/', '#/settings'].includes(location.hash)) rerender();
}
function openExternal(url) {
  if (BitNative) return BitNative.openUrl({ url }).catch(() => toast('Couldn’t open that link'));
  window.open(url, '_blank', 'noopener');
}

const srcBadge = (s) => `${s?.via === 'pinterest' ? '<span class="src pinterest">PIN</span>' : ''}<span class="src ${esc(s?.platform || 'text')}">${{ tiktok: 'TIKTOK', instagram: 'REELS', web: 'WEB', youtube: 'YT', text: 'TEXT', mine: 'MINE', ai: 'AI CHEF' }[s?.platform] || 'TEXT'}</span>`;

// ---------- screens ----------
function libraryView() {
  const q = (session.search || '').toLowerCase();
  const f = session.filter || 'all';
  const fam = f === 'family';
  const pool = fam ? familyRecipes(db) : db.recipes;
  const list = pool.filter((r) => (!q || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.item.toLowerCase().includes(q)))
    && (fam || f === 'all' || (f === 'fav' ? r.fav : (r.tags || []).includes(f))));
  const tags = allTags();
  const hasFamily = (db.family?.books || []).length > 0;
  return `
  <header class="top">
    <div class="brand">${logoSvg({ size: 36 })}<span class="word">bit<i>recipe</i></span></div>
    ${session.syncing ? '<span class="pill sync">⟳ PINTEREST</span>' : ''}
    <button class="icon-btn cartbtn" data-go="#/list" aria-label="Grocery list">🛒${db.grocery.entries.length + db.grocery.manual.length ? `<i>${db.grocery.entries.length + db.grocery.manual.length}</i>` : ''}</button>
    <button class="icon-btn" data-go="#/settings" aria-label="Settings">⚙</button>
  </header>
  <main>
    ${session.update ? `<div class="flag good updbar"><b>v${esc(session.update.version)} is out!</b> <button class="btn good" data-update>⬇ UPDATE</button></div>` : ''}
    ${levelBar()}
    <div class="panel">
      <div class="h">▶ NEW QUEST</div>
      <p class="small muted" style="margin-bottom:12px">Share a TikTok, Reel or recipe page to bitrecipe — or paste it here.</p>
      <button class="btn block" data-go="#/add">+ ADD A RECIPE</button>
      <button class="btn ai block" data-go="#/ai" style="margin-top:10px">✨ AI CHEF: MAKE ME A RECIPE</button>
      <div class="row" style="margin-top:10px"><button class="btn ghost grow" id="writeNew">✍ WRITE MY OWN</button><button class="btn alt grow" data-go="#/fridge">🧊 WHAT CAN I MAKE?</button></div>
    </div>
    <div class="row" style="margin-bottom:14px">
      <input class="field grow" id="search" placeholder="Search recipes or ingredients…" value="${esc(session.search || '')}">
    </div>
    <div class="chips filters">
      ${[['all', 'ALL'], ['fav', '★ FAVES'], ...tags.map((t) => [t, t.toUpperCase()]), ...(hasFamily ? [['family', '👪 FAMILY']] : [])].map(([k, l]) => `<button class="fchip${f === k ? ' on' : ''}" data-filter="${esc(k)}">${esc(l)}</button>`).join('')}
    </div>
    <div class="h">${fam ? 'FAMILY COOKBOOK' : f === 'all' ? 'COOKBOOK' : f === 'fav' ? 'FAVOURITES' : esc(f.toUpperCase())} · ${list.length}</div>
    ${list.length ? list.map((r) => `
      <div class="panel rcard" data-open="${esc(r._shared ? 'f:' + r.id : r.id)}">
        ${r.photo ? photoTag(r, 'thumb') : '<div class="strip"></div>'}
        <div class="body">
          <h3>${esc(r.title)}</h3>
          <div class="meta">${srcBadge(r.source)}
            ${r.time?.total ? `<span>⏱ ${minutesText(r.time.total)}</span>` : ''}
            <span>⇉ ${r.lanes.length} track${r.lanes.length > 1 ? 's' : ''}</span>
            <span>${r.ingredients.length} items</span>
            ${r.ingredients.some((i) => i.missing && i.qty == null) ? '<span style="color:var(--accent)">?? missing</span>' : ''}
            ${r.cooked ? `<span>★ ${r.cooked}</span>` : ''}
            ${r.needsReview ? '<span class="pill newpill">NEW · check me</span>' : ''}
            ${r.fav ? '<span class="favstar">★</span>' : ''}
            ${r._shared ? `<span>👪 ${esc(r._by || 'family')} · ${esc(r._bookName)}</span>` : ''}
          </div>
        </div>
        ${r._shared ? '' : `<button class="cardcart${db.grocery.entries.some((e) => e.rid === r.id) ? ' on' : ''}" data-cart="${esc(r.id)}" aria-label="Add to grocery list">${db.grocery.entries.some((e) => e.rid === r.id) ? '✓' : '🛒'}</button>`}
      </div>`).join('') : `<div class="empty">${fam ? 'No family recipes yet. Open one of yours and tap 👪 Share to family, or <button class="pill" id="writeNew">✍ write a new one</button>' : f === 'all' ? 'Nothing here yet.' : 'No recipes in this collection yet. Open a recipe and add it.'}</div>`}
    <p class="small muted" style="text-align:center;margin-top:20px">🛒 tap the cart on a recipe to add it to your grocery list</p>
  </main>`;
}

const SAMPLE_CAPTION = `Garlic parmesan chicken bites 🧄🧀 so easy!!
Ingredients:
500g chicken breast, cubed
3 tbsp butter
4 cloves garlic, minced
1 tsp paprika
a handful of parmesan
salt and pepper to taste
Method:
1. Season the chicken with the paprika, salt and pepper.
2. Melt the butter in a pan and fry the chicken for 8 minutes until golden.
3. Meanwhile, in a small bowl mix the garlic with the parmesan.
4. Add the garlic mixture to the pan and toss for 1 minute.
#easyrecipes #chicken #dinner`;

function addView() {
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">ADD RECIPE</div></header>
  <main>
    <div class="panel">
      <div class="h">PASTE A LINK OR THE RECIPE</div>
      <textarea class="field" id="src" placeholder="https://www.tiktok.com/@…\nhttps://www.instagram.com/reel/…\nhttps://anyrecipesite.com/…\n\n…or paste the caption / recipe text">${esc(session.pendingInput)}</textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn ghost" id="paste">📋 PASTE</button>
        <button class="btn grow" id="go">IMPORT ▶</button>
      </div>
      <div id="importing"></div>
    </div>
    <div class="panel">
      <div class="h">HOW IT READS THINGS</div>
      <ul class="small" style="padding-left:18px;line-height:1.7">
        <li><b>Recipe sites:</b> reads the hidden recipe card most sites include. Best results.</li>
        <li><b>TikTok:</b> reads the caption. If the recipe is only spoken, paste the steps.</li>
        <li><b>Reels:</b> reads the caption when Instagram allows it.</li>
        <li><b>Anything else:</b> paste the text — captions, notes, a message from Grandma.</li>
      </ul>
      <p class="small muted" style="margin-top:10px">You always get to check everything before saving. Missing amounts are flagged, never guessed. Saved recipes stay private on your phone.</p>
      <button class="btn ghost block" id="trysample" style="margin-top:12px">TRY A SAMPLE CAPTION</button>
      <button class="btn alt block" id="writeNew" style="margin-top:10px">✍ OR WRITE YOUR OWN FROM SCRATCH</button>
    </div>
  </main>`;
}

function reviewView() {
  const d = session.draft;
  if (!d) return go('#/'), '';
  const lanes = d.lanes;
  const laneBtn = (s, l, k) => `<button class="lane-${k + 1}${s.lane === l.id ? ' on' : ''}" data-lane="${esc(s.id)}:${esc(l.id)}">${esc(l.id)}</button>`;
  const joinBtn = (s, l, k) => l.id === s.lane ? '' : `<button class="lane-${k + 1}${(s.merges || []).includes(l.id) ? ' on' : ''}" data-join="${esc(s.id)}:${esc(l.id)}">+ ${esc(l.name)}</button>`;
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">${session.writing ? 'WRITE A RECIPE' : session.editing ? 'EDIT RECIPE' : 'CHECK IT'}</div></header>
  <main>
    ${session.flags.map((f) => `<div class="flag ${f.level}">${esc(f.text)}</div>`).join('')}
    <div class="panel photopick">
      ${d.photo ? `<img class="heroimg" src="${d.photo}" alt="">` : d.image ? '<p class="hint">📷 Photo found on the page — it’s saved with the recipe.</p>' : '<p class="hint">No photo yet.</p>'}
      <div class="row" style="margin-top:10px">
        <label class="btn ghost grow" style="text-align:center">📷 ${d.photo ? 'CHANGE PHOTO' : 'ADD PHOTO'}<input type="file" id="photoIn" accept="image/*" hidden></label>
        ${d.photo ? '<button class="btn ghost" id="photoOut">✕</button>' : ''}
      </div>
    </div>
    <div class="panel">
      <label class="lbl">Title</label><input class="field" data-f="title" value="${esc(d.title)}">
      <div class="row">
        <div class="grow"><label class="lbl">Serves</label><input class="field" type="number" min="1" data-f="servings" value="${esc(d.servings)}"></div>
        <div class="grow"><label class="lbl">Hands-on min</label><input class="field" type="number" min="0" data-f="active" value="${esc(d.time?.active || '')}"></div>
        <div class="grow"><label class="lbl">Total min</label><input class="field" type="number" min="0" data-f="total" value="${esc(d.time?.total || '')}"></div>
      </div>
      <label class="lbl">Creator / source</label><input class="field" data-f="creator" value="${esc(d.source?.creator || '')}">
      ${d.source?.url ? `<p class="hint">Link kept: ${esc(d.source.url)}</p>` : ''}
    </div>
    <div class="panel">
      <div class="h">INGREDIENTS · ONE PER LINE</div>
      ${session.writing ? '<p class="hint" style="margin:-4px 0 10px">Type them like you’d say them: “2 cups flour”, “3 cloves garlic, minced”, “salt to taste”. Amounts scale and convert automatically.</p>' : ''}
      ${d.ingredients.map((i, k) => `
        <div class="ed-row${i.missing && i.qty == null ? ' flagged' : ''}">
          <div class="grow"><input class="field" data-ing="${k}" value="${esc(ingLine(i))}">
          ${i.missing && i.qty == null ? `<div class="hint" style="color:var(--accent)">?? ${esc(i.note || 'No amount in the source')} — type an amount, or leave it flagged.</div>` : ''}</div>
          <button class="x" data-delIng="${k}" aria-label="Remove">✕</button>
        </div>`).join('')}
      <button class="btn ghost" id="addIng">+ INGREDIENT</button>
    </div>
    <div class="panel">
      <div class="h">TRACKS</div>
      <p class="hint" style="margin:-4px 0 10px">A track is one bowl, pan or job. Things on different tracks can happen at the same time.</p>
      ${lanes.map((l, k) => `<div class="ed-row"><span class="tag lane-${k + 1}" style="padding:12px 10px">${esc(l.id)}</span><input class="field" data-lanename="${esc(l.id)}" value="${esc(l.name)}"></div>`).join('')}
      ${lanes.length < 3 ? '<button class="btn ghost" id="addLane">+ TRACK</button>' : ''}
    </div>
    <div class="panel">
      <div class="h">STEPS</div>
      <p class="hint" style="margin:-4px 0 10px">${session.writing ? 'Just mention an ingredient (“mix the flour and sugar”) and its amount appears in the step. Give a step a timer and mark slow parts as hands-off. Use tracks when two things happen at once.' : '[brackets] show where an amount appears — it scales with servings.'}</p>
      ${d.steps.map((s, k) => `
        <div class="ed-step">
          <div class="row" style="margin-bottom:6px"><span class="sn">${String(k + 1).padStart(2, '0')}</span><span class="grow"></span><button class="x pill" data-delStep="${k}">✕ remove</button></div>
          <textarea class="field" data-step="${k}">${esc(tokensToMarkers(s.text, d.ingredients))}</textarea>
          <div class="ctl"><span class="muted">Track</span><span class="lanepick row" style="gap:4px">${lanes.map((l, j) => laneBtn(s, l, j)).join('')}</span></div>
          ${lanes.length > 1 ? `<div class="ctl"><span class="muted">Joins in</span><span class="joinpick row" style="gap:4px">${lanes.map((l, j) => joinBtn(s, l, j)).join('')}</span></div>` : ''}
          <div class="ctl"><span class="muted">Timer</span><input class="field" style="width:90px;padding:6px" type="number" min="0" data-timer-min="${k}" value="${esc(s.timer?.min || '')}" placeholder="min"><label class="row" style="gap:4px"><input type="checkbox" data-wait="${k}" ${s.wait ? 'checked' : ''}> hands-off</label></div>
        </div>`).join('')}
      <button class="btn ghost" id="addStep">+ STEP</button>
    </div>
    ${d.importDebug && !session.editing ? '<button class="btn ghost block" id="report" style="margin-bottom:18px">🐞 SEND THIS IMPORT TO FIX THE IMPORTER</button>' : ''}
    <div class="panel"><div class="h">PREVIEW</div>${renderLegend(d)}${renderTrackMap(finalize(structuredClone(d), true), { factor: 1, system: 'orig' })}</div>
  ${signedIn() && (db.family?.books || []).length && !session.editing ? `<div class="panel"><label class="row" style="gap:8px"><input type="checkbox" id="alsoFamily" ${session.alsoFamily ? 'checked' : ''}> <span>Also share to <b>${esc(db.family.books[0].name)}</b> 👪</span></label></div>` : ''}
  </main>
  <div class="dock"><div class="inner"><button class="btn good block" id="saveDraft">✓ SAVE RECIPE</button></div></div>`;
}

function ingLine(i) {
  if (i.raw && !i.edited) return i.raw;
  const amt = i.qty == null ? '' : amountText(i, 1, 'orig') + ' ';
  return `${amt}${i.item}${i.prep ? ', ' + i.prep : ''}${i.loose ? ' ' + i.loose : ''}`.trim();
}

// Read the review form back into the draft.
function syncDraft() {
  const d = session.draft;
  if (!d) return;
  const val = (sel) => $app.querySelector(sel)?.value;
  d.title = val('[data-f=title]')?.trim() || d.title;
  d.servings = Math.max(1, parseInt(val('[data-f=servings]'), 10) || d.servings);
  const total = parseInt(val('[data-f=total]'), 10);
  const active = parseInt(val('[data-f=active]'), 10);
  d.time = { ...(d.time || {}), total: total || null, active: active || null };
  d.source = { ...(d.source || {}), creator: val('[data-f=creator]') ?? d.source?.creator };
  $app.querySelectorAll('[data-ing]').forEach((el) => {
    const k = +el.dataset.ing;
    const old = d.ingredients[k];
    if (el.value.trim() === ingLine(old)) return;
    const n = parseIngredientLine(el.value);
    if (n) d.ingredients[k] = { ...n, id: old.id, edited: true, raw: el.value.trim() };
  });
  $app.querySelectorAll('[data-lanename]').forEach((el) => { const l = d.lanes.find((x) => x.id === el.dataset.lanename); if (l) l.name = el.value.trim() || l.name; });
  $app.querySelectorAll('textarea[data-step]').forEach((el) => { d.steps[+el.dataset.step].text = markersToTokens(el.value, d.ingredients); });
  $app.querySelectorAll('[data-timer-min]').forEach((el) => {
    const s = d.steps[+el.dataset.timerMin];
    const m = parseInt(el.value, 10);
    s.timer = m ? { min: m, label: s.timer?.label || timerFrom(`${m} min ${s.text}`)?.label || 'Timer' } : null;
  });
  $app.querySelectorAll('[data-wait]').forEach((el) => { d.steps[+el.dataset.wait].wait = el.checked; });
}

function finalize(d, preview = false) {
  d.ingredients = d.ingredients.filter((i) => i.item);
  d.steps = d.steps.filter((s) => s.text.trim());
  linkSteps(d.ingredients, d.steps);
  const used = new Set(d.steps.flatMap((s) => [s.lane, ...(s.merges || [])]));
  if (!preview) d.lanes = d.lanes.filter((l) => used.has(l.id));
  if (!d.lanes.length) d.lanes = [{ id: 'A', name: 'Main' }];
  if (!preview && (!d.equipment || !d.equipment.length)) d.equipment = guessEquipment(d.steps.map((s) => s.text));
  return d;
}

function recipeView(r) {
  const ctx = ctxFor(r);
  const shared = !!r._shared;
  const books = db.family?.books || [];
  const have = (session.have[r.id] ||= new Set());
  const prepList = r.ingredients.filter((i) => i.prep && /chop|dice|mince|slice|grate|peel|melt|soft|cube|crush|zest|juice|room|sift|beat|drain|rinse|pack/i.test(i.prep));
  const missing = r.ingredients.filter((i) => i.qty == null && !i.loose);
  const sys = db.prefs.system;
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">${esc(r.title)}</div><button class="icon-btn" data-go="#/theme" aria-label="Colours">🎨</button></header>
  <main>
    <div class="panel">
      <div class="row" style="margin-bottom:8px">${srcBadge(r.source)}<span class="small muted">${esc(r.source?.creator || '')}</span>
        ${r.source?.url ? `<a class="small" href="${esc(r.source.url)}" target="_blank" rel="noopener">open original ↗</a>` : ''}</div>
      ${r.photo ? `<div class="hero">${photoTag(r, 'heroimg')}</div>` : ''}
      <div class="row" style="align-items:flex-start;gap:8px"><h1 class="rtitle grow">${esc(r.title)}</h1>${shared ? '' : `<button class="favbtn${r.fav ? ' on' : ''}" id="fav" aria-label="Favourite">${r.fav ? '★' : '☆'}</button>`}</div>
      ${shared ? `<p class="small muted" style="margin-bottom:6px">👪 Shared by <b>${esc(r._by || 'family')}</b> in ${esc(r._bookName)}</p>` : `
      <div class="chips tagrow">${[...new Set([...SUGGESTED_TAGS, ...allTags()])].map((t) => `<button class="tchip${(r.tags || []).includes(t) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}<button class="tchip add" id="newTag">+ tag</button></div>`}
      <div class="stats">
        <div class="stat"><b>${r.time?.active ? minutesText(r.time.active) : '—'}</b><span>hands-on</span></div>
        <div class="stat"><b>${r.time?.total ? minutesText(r.time.total) : '—'}</b><span>total</span></div>
        <div class="stat"><b>${maxParallel(r)}×</b><span>at once</span></div>
      </div>
      <div class="row" style="justify-content:space-between">
        <div class="scaler"><button data-serv="-1" aria-label="Fewer">−</button><output>${ctx.servings} ${esc(r.servingsLabel || 'servings')}</output><button data-serv="1" aria-label="More">+</button></div>
        ${ctx.servings !== r.servings ? `<button class="pill" data-serv="reset">reset ×${Math.round(ctx.factor * 100) / 100}</button>` : ''}
      </div>
      <div class="seg-ctl" style="margin-top:12px">
        ${[['orig', 'AS WRITTEN'], ['metric', 'METRIC'], ['us', 'US CUPS']].map(([k, l]) => `<button data-sys="${k}" class="${sys === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
    </div>

    ${r.needsReview ? `<div class="panel newbox">
      <div class="h">📌 NEW FROM PINTEREST${r.source?.board ? ' · ' + esc(r.source.board).toUpperCase() : ''}</div>
      ${(r.reviewFlags || []).map((f) => `<div class="flag ${f.level}">${esc(f.text)}</div>`).join('')}
      <div class="row"><button class="btn good grow" id="looksGood">✓ LOOKS GOOD</button><button class="btn ghost grow" data-go="#/edit/${esc(r.id)}">✎ FIX IT</button></div>
    </div>` : ''}
    ${missing.length ? `<div class="flag warn">?? ${missing.length} amount${missing.length > 1 ? 's' : ''} missing from the source: ${missing.map((i) => esc(i.item)).join(', ')}. <a href="#/edit/${esc(r.id)}">Fill in</a></div>` : ''}

    ${r.equipment?.length || prepList.length ? `<div class="panel">
      <div class="h">BEFORE YOU START</div>
      ${r.equipment?.length ? `<p class="small muted" style="margin-bottom:6px">Get out:</p><div class="chips" style="margin-bottom:12px">${r.equipment.map((e) => `<span class="chip">${esc(e)}</span>`).join('')}</div>` : ''}
      ${prepList.length ? `<p class="small muted">Prep first:</p><ul class="checklist">${prepList.map((i) => `<li data-have="prep-${esc(i.id)}" class="${have.has('prep-' + i.id) ? 'on' : ''}"><span class="box">${have.has('prep-' + i.id) ? '✓' : ''}</span><span class="txt">${esc(cap(i.item))} <span class="prep">→ ${esc(i.prep)}</span></span></li>`).join('')}</ul>` : ''}
    </div>` : ''}

    <div class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:6px"><div class="h" style="margin:0">INGREDIENTS</div><span class="small muted">tick what you have</span></div>
      <ul class="checklist">${r.ingredients.map((i) => {
        const a = amountText(i, ctx.factor, sys);
        const on = have.has(i.id);
        return `<li data-have="${esc(i.id)}" class="${on ? 'on' : ''}"><span class="box">${on ? '✓' : ''}</span><span class="txt">
          ${a == null ? '<b class="amt missing">??</b>' : `<b class="amt">${esc(a)}</b>`} ${esc(itemText(i, ctx.factor))}${i.prep ? `<span class="prep">, ${esc(i.prep)}</span>` : ''}
          ${a == null ? `<span class="ingnote">${esc(i.note || 'No amount in the source')}${i.suggest ? ` · <span class="sug">suggested: ${esc(amountText({ ...i, ...i.suggest, missing: false }, ctx.factor, sys))}</span>` : ''}</span>` : ''}
        </span></li>`;
      }).join('')}</ul>
      <button class="btn alt block" id="toList" style="margin-top:12px">🛒 ${db.grocery.entries.some((e) => e.rid === r.id) ? 'UPDATE LIST' : 'ADD MISSING TO LIST'}${have.size ? ` · ${r.ingredients.filter((i) => !have.has(i.id)).length} ITEMS` : ''}</button>
    </div>

    ${r.tips?.length ? `<div class="panel"><div class="h">✨ CHEF’S TIPS</div><ul class="tips">${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}

    <div class="panel">
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <div class="h" style="margin:0">METHOD</div>
        <div class="seg-ctl" style="width:190px">
          <button data-view="map" class="${db.prefs.view === 'map' ? 'on' : ''}">TRACK MAP</button>
          <button data-view="list" class="${db.prefs.view === 'list' ? 'on' : ''}">LIST</button>
        </div>
      </div>
      ${db.prefs.view === 'map' ? renderLegend(r) + renderTrackMap(r, ctx) : renderList(r, ctx)}
      <p class="hint" style="margin-top:8px">Tap a step to tick it off.</p>
    </div>

    <div class="row" style="margin-bottom:10px">
      <button class="btn ghost grow" id="shareCard">📤 SHARE CARD</button>
      <button class="btn ghost grow" id="aiTweak">✨ AI TWEAK</button>
      ${shared ? '<button class="btn good grow" id="saveShared">⬇ SAVE TO MY COOKBOOK</button>' : signedIn() && books.length ? '<button class="btn ghost grow" id="toFamily">👪 SHARE TO FAMILY</button>' : ''}
    </div>
    ${shared ? '' : `<div class="row">
      <button class="btn ghost grow" data-go="#/edit/${esc(r.id)}">✎ EDIT</button>
      <button class="btn ghost grow" id="dup">⧉ MY VERSION</button>
      <button class="btn ghost" id="del" aria-label="Delete">🗑</button>
    </div>
    ${r.importDebug ? '<button class="btn ghost block" id="report" style="margin-top:12px">🐞 THIS IMPORT WENT WRONG</button>' : ''}`}
  </main>
  <div class="dock"><div class="inner"><button class="btn block" id="cook">▶ COOK MODE</button></div></div>`;
}

const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const SUGGESTED_TAGS = ['Dinner', 'Dessert', 'Breakfast', 'Quick', 'Baking', 'Snack'];
function allTags() {
  const seen = new Set();
  for (const r of db.recipes) for (const t of r.tags || []) seen.add(t);
  return [...seen].sort();
}

function settingsView() {
  const st = session.alerts;
  const row = (ok, label, help, btn) => `<div class="setrow"><div class="grow"><b>${label}</b><span class="small muted">${help}</span></div>${ok ? '<span class="okmark">✓ ON</span>' : btn}</div>`;
  const boards = db.pinterest?.boards || [];
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">SETTINGS</div></header>
  <main>
    <div class="panel">
      <div class="h">☁ 128BIT ACCOUNT</div>
      ${signedIn() ? `
        <div class="setrow"><div class="grow"><b>${esc(accountEmail() || 'Signed in')}</b><span class="small muted">${session.syncing2 ? '⟳ Syncing…' : db.sync?.error ? `<span style="color:var(--accent)">${esc(db.sync.error)}</span>` : db.sync?.last ? `Synced ${ago(db.sync.last)} · recipes, list, XP and colours` : 'Not synced yet'}</span></div>
          <button class="btn alt" id="syncAcc" ${session.syncing2 ? 'disabled' : ''}>SYNC</button></div>
        <div class="setrow"><div class="grow"><b>Share cooking to my family feed</b><span class="small muted">Recipes you save and cook show up on 128bit Tracker’s timeline. Off until you turn it on.</span></div>
          <div class="seg-ctl" style="width:120px"><button data-feed="1" class="${db.prefs.shareFeed ? 'on' : ''}">ON</button><button data-feed="0" class="${db.prefs.shareFeed ? '' : 'on'}">OFF</button></div></div>
        <div class="row" style="margin-top:10px"><button class="btn ghost grow" id="signOut">SIGN OUT</button><button class="btn ghost grow" id="wipeServer">REMOVE FROM SERVER</button></div>`
      : `
        <p class="small muted" style="margin-bottom:10px">Sign in with the same account as 128bit Play, Tracker and FIT to keep your recipes, grocery list, XP and colours on all your devices.</p>
        <input class="field" id="accEmail" type="email" autocomplete="email" placeholder="Email" value="${esc(session.accEmail || '')}" style="margin-bottom:8px">
        <input class="field" id="accPass" type="password" autocomplete="current-password" placeholder="Password">
        <div class="row" style="margin-top:10px"><button class="btn grow" id="accIn">SIGN IN</button><button class="btn ghost grow" id="accUp">CREATE ACCOUNT</button></div>
        <button class="pill" id="accForgot" style="margin-top:10px">Forgot password?</button>
        <div id="accMsg"></div>`}
    </div>
    ${signedIn() ? `<div class="panel">
      <div class="h">👪 FAMILY COOKBOOK</div>
      <p class="small muted" style="margin-bottom:10px">A recipe book you share with family. Everyone with the code can add recipes and save copies. Each person still has their own cookbook.</p>
      <label class="lbl">Your name (shown on recipes you share)</label>
      <input class="field" id="famName" value="${esc(db.family?.name || '')}" placeholder="e.g. Dad">
      ${(db.family?.books || []).map((b) => `<div class="setrow"><div class="grow"><b>${esc(b.name)}</b><span class="small muted">${((n) => `${n} recipe${n === 1 ? '' : 's'}`)(Object.keys(db.family.recipes?.[b.id] || {}).length)}</span><span class="codeline">CODE <b class="px code">${esc(b.code)}</b></span></div>
        <button class="btn ghost" data-sharecode="${esc(b.code)}" data-bookname="${esc(b.name)}">INVITE</button><button class="x pill" data-leave="${esc(b.id)}">leave</button></div>`).join('')}
      <div class="row" style="margin-top:10px"><input class="field grow" id="bookName" placeholder="New cookbook name"><button class="btn" id="mkBook">CREATE</button></div>
      <div class="row" style="margin-top:8px"><input class="field grow" id="bookCode" placeholder="Join code (6 letters)" style="text-transform:uppercase"><button class="btn alt" id="joinBook">JOIN</button></div>
      <div id="famMsg"></div>
    </div>` : ''}
    <div class="panel">
      <div class="h">⏱ TIMER ALERTS</div>
      ${!BitNative ? '<p class="small muted">Timer alarms ring through Do Not Disturb in the Android app. In this browser preview they only beep while the page is open.</p>' : !st ? '<p class="small muted">Checking…</p>' : `
        ${row(st.notifications, 'Notifications', 'So timers ring when bitrecipe is closed or the screen is off.', '<button class="btn alt" data-perm="notifications">ALLOW</button>')}
        ${row(st.exactAlarms, 'On-the-second timing', 'Without it, Android may ring a timer up to a minute late.', '<button class="btn alt" data-perm="exact">FIX</button>')}
        ${row(st.dnd, 'Ring through Do Not Disturb', 'Timers already use the alarm sound, which Do Not Disturb lets through unless you muted alarms. Turn this on to get through even then.', '<button class="btn alt" data-perm="dnd">ALLOW</button>')}
        <button class="btn ghost block" id="testTimer" style="margin-top:12px">TEST: RING IN 10 SECONDS</button>`}
    </div>

    <div class="panel">
      <div class="h">📌 PINTEREST BOARDS</div>
      <p class="small muted" style="margin-bottom:10px">Follow a <b>public</b> board. Pins you add to it that link to a recipe show up in your cookbook marked NEW for a quick check. bitrecipe looks for new pins whenever you open it.</p>
      <div class="row"><input class="field grow" id="boardUrl" placeholder="pinterest.com/you/dinner-ideas"><button class="btn" id="addBoard">FOLLOW</button></div>
      <div id="boardMsg"></div>
      ${boards.map((b, k) => `<div class="setrow"><div class="grow"><b>${esc(b.name)}</b><span class="small muted">${b.error ? `<span style="color:var(--accent)">${esc(b.error)}</span>` : b.last ? `checked ${ago(b.last)} · ${b.added || 0} added` : 'not checked yet'}</span></div><button class="x pill" data-unboard="${k}">✕ unfollow</button></div>`).join('')}
      ${boards.length ? `<button class="btn ghost block" id="syncNow" style="margin-top:10px" ${session.syncing ? 'disabled' : ''}>${session.syncing ? '⟳ CHECKING…' : '⟳ CHECK NOW'}</button>` : ''}
      ${!BitNative ? '<p class="hint">Board syncing works in the Android app (browsers block reading Pinterest).</p>' : ''}
    </div>

    <div class="panel">
      <div class="h">TIKTOK & REELS</div>
      <p class="small muted">TikTok and Instagram don’t let other apps read your saved collections, so there’s no auto-sync for those. Instead, tap <b>Share</b> on any video and pick <b>bitrecipe</b>, which takes two taps.</p>
    </div>

    <div class="panel">
      <div class="h">LOOK & FEEL</div>
      <button class="btn ghost block" data-go="#/theme">🎨 COLOURS & THEMES</button>
      <div class="setrow" style="margin-top:10px"><div class="grow"><b>Animations</b><span class="small muted">Steam, bubbling timers, confetti and wipes.</span></div>
        <div class="seg-ctl" style="width:150px"><button data-motion="1" class="${db.prefs.motion !== false ? 'on' : ''}">ON</button><button data-motion="0" class="${db.prefs.motion === false ? 'on' : ''}">CALM</button></div></div>
    </div>
    <div class="panel">
      <div class="h">💾 BACKUP</div>
      <p class="small muted" style="margin-bottom:10px">Save everything (recipes, photos, grocery list, XP, boards, colours) to a file, or load one back. Restoring adds to what's here and never deletes.</p>
      <div class="row"><button class="btn ghost grow" id="backup">⬇ SAVE BACKUP</button><label class="btn ghost grow" style="text-align:center">⬆ RESTORE<input type="file" id="restore" accept="application/json,.json" hidden></label></div>
    </div>

    <div class="panel">
      <div class="h">ABOUT</div>
      <div class="setrow"><div class="grow"><b>bitrecipe v${esc(VERSION)}</b><span class="small muted">${session.update ? `v${esc(session.update.version)} is available` : 'Checks GitHub Releases for new builds'}</span></div>
        ${session.update ? '<button class="btn good" data-update>⬇ UPDATE</button>' : '<button class="btn ghost" id="checkUpd">CHECK</button>'}</div>
      <button class="btn ghost block" data-go="#/badges" style="margin-top:10px">${trophy(14)} BADGES & LEVEL</button>
    </div>
    <p class="small muted" style="text-align:center">★ ${db.xp || 0} XP · ${db.recipes.length} recipes</p>
  </main>`;
}

const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };

async function refreshAlerts() {
  if (!BitNative) return;
  try { session.alerts = await BitNative.alertStatus(); } catch { session.alerts = null; }
  if (location.hash.startsWith('#/settings')) rerender();
}

// ---------- Pinterest sync ----------
async function runPinterestSync(manual = false) {
  const boards = db.pinterest?.boards || [];
  if (!boards.length || session.syncing || !BitNative && !manual) return;
  session.syncing = true;
  if (['', '#/', '#/settings'].includes(location.hash)) rerender();
  try {
    const { added } = await syncBoards(boards, {
      saveRecipe: (rec) => { db.recipes.unshift(rec); emit('recipe.saved', { recipeId: rec.id, title: rec.title, platform: 'pinterest' }); award(XP.save, 'saved'); ensurePhoto(rec); },
      isKnownUrl: (u) => db.recipes.some((r) => r.source?.url === u),
    });
    save();
    if (added) toast(`📌 ${added} new recipe${added > 1 ? 's' : ''} from Pinterest`);
    else if (manual) toast('No new recipe pins');
  } catch { if (manual) toast('Couldn’t reach Pinterest'); }
  session.syncing = false;
  if (['', '#/', '#/settings'].includes(location.hash)) rerender();
}

// "What can I make?": tick what you have, recipes sort by how little is missing.
const STAPLES = ['salt', 'pepper', 'oil', 'olive oil', 'water', 'black pepper', 'vegetable oil'];
function fridgeData() {
  db.fridge ||= { have: [], staples: true };
  const counts = new Map();
  const all = [...db.recipes, ...(db.family ? familyRecipes(db) : [])];
  for (const r of all) for (const i of r.ingredients) {
    const k = keyOf(i.item); if (!k) continue;
    const c = counts.get(k) || { key: k, name: i.item.toLowerCase(), n: 0 };
    c.n++; if (i.item.length < c.name.length) c.name = i.item.toLowerCase();
    counts.set(k, c);
  }
  const have = new Set(db.fridge.have);
  const staple = (k) => db.fridge.staples && STAPLES.includes(k);
  const results = all.map((r) => {
    const need = [...new Map(r.ingredients.filter((i) => !i.loose).map((i) => [keyOf(i.item), i])).entries()].filter(([k]) => k && !staple(k));
    const missing = need.filter(([k]) => !have.has(k));
    return { r, need: need.length, missing: missing.map(([, i]) => i), got: need.length - missing.length };
  }).filter((x) => x.got > 0 || !have.size).sort((a, b) => a.missing.length - b.missing.length || b.got - a.got);
  return { chips: [...counts.values()].filter((c) => !staple(c.key)).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)), have, results };
}

function fridgeView() {
  const { chips, have, results } = fridgeData();
  const q = (session.fq || '').toLowerCase();
  const shown = chips.filter((c) => !q || c.name.includes(q));
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">WHAT CAN I MAKE?</div></header>
  <main>
    <div class="panel">
      <div class="h">🧊 TAP WHAT YOU HAVE · ${have.size}</div>
      <input class="field" id="fq" placeholder="Find an ingredient…" value="${esc(session.fq || '')}" style="margin-bottom:10px">
      <div class="chips">${shown.map((c) => `<button class="tchip${have.has(c.key) ? ' on' : ''}" data-have-k="${esc(c.key)}">${esc(c.name)}</button>`).join('') || '<span class="small muted">No ingredients match.</span>'}</div>
      <div class="row" style="margin-top:12px;justify-content:space-between">
        <label class="row small" style="gap:6px"><input type="checkbox" id="staples" ${db.fridge.staples ? 'checked' : ''}> I always have salt, pepper, oil & water</label>
        ${have.size ? '<button class="pill" id="fridgeClear">clear</button>' : ''}
      </div>
    </div>
    ${!have.size ? '<p class="small muted" style="text-align:center">Tick a few things in your kitchen and the best matches show up here.</p>' : results.length ? results.map(({ r, missing, need }) => `
      <div class="panel rcard fridgecard" data-open="${esc(r._shared ? 'f:' + r.id : r.id)}">
        ${r.photo ? photoTag(r, 'thumb') : '<div class="strip"></div>'}
        <div class="body">
          <h3>${esc(r.title)}</h3>
          ${missing.length ? `<div class="small"><b style="color:var(--accent2)">Missing ${missing.length} of ${need}:</b> <span class="muted">${missing.slice(0, 6).map((i) => esc(i.item)).join(', ')}${missing.length > 6 ? '…' : ''}</span></div>` : '<div class="small" style="color:var(--good);font-weight:700">✓ You have everything!</div>'}
          <div class="xpbar" style="margin:8px 0 0"><i style="width:${Math.round(((need - missing.length) / Math.max(1, need)) * 100)}%;background:var(--good)"></i></div>
        </div>
        ${missing.length && !r._shared ? `<button class="cardcart" data-cartmissing="${esc(r.id)}" aria-label="Add missing to grocery list">🛒</button>` : ''}
      </div>`).join('') : '<div class="empty">No recipes use those ingredients yet.</div>'}
  </main>`;
}

// ---------- AI chef ----------
const AI_IDEAS = ['Quick weeknight pasta', 'Use up ripe bananas', 'High-protein breakfast', 'Kid-friendly dinner', 'One-pan chicken', 'Vegan curry', 'Easy birthday cake', 'Meal-prep lunches'];
function aiView() {
  const a = (db.ai ||= { engine: 'claude', diet: '', servings: 4, time: '', useFridge: false });
  const eng = session.aiEngines;
  const busy = session.aiBusy;
  if (!signedIn()) return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">AI CHEF</div></header>
  <main><div class="panel empty">${chef(48)}<p style="margin:12px 0">The AI chef works with your 128bit account (it keeps everyone’s AI use fair).</p><button class="btn" data-go="#/settings">SIGN IN</button></div></main>`;
  const engBtn = (k, label, sub) => `<button data-engine="${k}" class="${a.engine === k ? 'on' : ''}" ${eng && !eng[k] ? 'disabled title="Not set up on the server yet"' : ''}>${label}<small>${sub}</small></button>`;
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">✨ AI CHEF</div></header>
  <main>
    <div class="panel">
      <div class="h">WHAT DO YOU WANT TO MAKE?</div>
      <textarea class="field" id="aiPrompt" placeholder="e.g. cosy chicken soup with what I’ve got, or a chocolate cake for 12 that isn’t too sweet" ${busy ? 'disabled' : ''}>${esc(session.aiPrompt || '')}</textarea>
      <div class="chips" style="margin-top:10px">${AI_IDEAS.map((i) => `<button class="tchip" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div>
    </div>
    <div class="panel">
      <div class="row">
        <div class="grow"><label class="lbl">Serves</label><input class="field" type="number" min="1" max="50" id="aiServ" value="${esc(a.servings)}"></div>
        <div class="grow"><label class="lbl">Time</label><select class="field" id="aiTime">${[['', 'Any'], ['15 minutes', '15 min'], ['30 minutes', '30 min'], ['1 hour', '1 hour'], ['all afternoon', 'Lots']].map(([v, l]) => `<option value="${v}" ${a.time === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <label class="lbl">Diet, allergies, things to avoid</label>
      <input class="field" id="aiDiet" placeholder="e.g. no nuts, vegetarian, dairy-free" value="${esc(a.diet || '')}">
      <label class="row small" style="gap:8px;margin-top:12px"><input type="checkbox" id="aiFridge" ${a.useFridge ? 'checked' : ''}> Use what’s in my fridge (${(db.fridge?.have || []).length} ticked in 🧊 What can I make?)</label>
    </div>
    <div class="panel">
      <div class="h">AI ENGINE</div>
      <div class="engines">${engBtn('claude', 'CLAUDE', 'best recipes')}${engBtn('gemini', 'GEMINI', 'quick & smart')}${engBtn('groq', 'GROQ', 'super fast')}${engBtn('cerebras', 'CEREBRAS', 'lightning fast')}${engBtn('openrouter', 'OPENROUTER', 'free models')}</div>
      ${eng && !Object.values(eng).some(Boolean) ? '<p class="hint" style="color:var(--accent)">The 128bit server didn’t list any AI engines. <button class="pill" id="aiRecheck">↻ check again</button></p>' : ''}
      <button class="btn ghost block" id="aiCheck" style="margin-top:12px" ${session.aiChecking ? 'disabled' : ''}>${session.aiChecking ? '🔍 TESTING EACH ENGINE… (UP TO A MINUTE)' : '🔍 CHECK ENGINES'}</button>
      ${session.aiCheck ? engineReport(session.aiCheck) : ''}
    </div>
    ${busy ? `<div class="loading">${chef(56)}<div class="loadbar"><i></i></div><span class="px small">COOKING UP YOUR RECIPE</span><p class="small muted">${['groq', 'cerebras'].includes(a.engine) ? 'A few seconds…' : a.engine === 'claude' ? 'This takes about 20–40 seconds.' : 'About 10–30 seconds…'}</p></div>`
      : `<button class="btn ai block" id="aiGo">✨ MAKE MY RECIPE</button>`}
    <div id="aiMsg">${session.aiError ? `<div class="flag bad" style="margin-top:12px">${esc(session.aiError)}</div>` : ''}</div>
    <p class="small muted" style="text-align:center;margin-top:14px">You check and edit every AI recipe before it’s saved. AI can get things wrong, so trust your nose.</p>
  </main>`;
}

// Ask the server which engines have keys. Re-checked every time AI Chef opens
// (at most every 15 s), so keys added on the server show up without a restart.
let enginesAt = 0;
function refreshEngines(force = false) {
  if (!signedIn() || session.aiEnginesBusy || (!force && Date.now() - enginesAt < 15000)) return;
  session.aiEnginesBusy = true;
  callFunction('bitrecipe-ai', null, { method: 'GET' }).then((r) => {
    enginesAt = Date.now();
    const before = JSON.stringify(session.aiEngines);
    session.aiEngines = r.engines;
    db.ai ||= { engine: 'claude', diet: '', servings: 4, time: '', useFridge: false };
    if (r.engines && !r.engines[db.ai.engine]) db.ai.engine = ['claude', 'gemini', 'groq', 'cerebras', 'openrouter'].find((e) => r.engines[e]) || db.ai.engine;
    if (location.hash === '#/ai' && JSON.stringify(r.engines) !== before) rerender();
  }).catch(() => {}).finally(() => { session.aiEnginesBusy = false; });
}

// Results of "Check engines": a tiny test recipe through every engine that has a key.
function engineReport(c) {
  const names = { claude: 'Claude', gemini: 'Gemini', groq: 'Groq', cerebras: 'Cerebras', openrouter: 'OpenRouter' };
  const rows = Object.entries(names).map(([k, label]) => {
    const r = c[k] || {};
    const state = !r.set ? '<span class="muted">no key</span>' : r.ok ? `<b style="color:var(--good)">✓ works</b> · ${(r.ms / 1000).toFixed(1)}s` : '<b style="color:var(--accent)">✗ failed</b>';
    const detail = r.ok ? `model: ${esc(r.model || '?')}` : r.error ? esc(r.error) : '';
    return `<div class="setrow"><div class="grow"><b>${label}</b><span class="small muted">${detail}</span></div><span class="small">${state}</span></div>`;
  }).join('');
  const gm = c.geminiModels ? `<details class="small" style="margin-top:8px"><summary>Gemini models your key can use (${c.geminiModels.available?.length || 0}) · trying <b>${esc(c.geminiModels.using || '?')}</b> first</summary><p class="muted" style="margin-top:6px">${(c.geminiModels.available || []).map(esc).join(', ') || 'none returned. Check the key in Google AI Studio.'}</p><p class="hint">To force one, add a <b>GEMINI_MODEL</b> secret in Supabase with its name.</p></details>` : '';
  const or = c.openrouterModels?.trying?.length ? `<p class="hint">OpenRouter free models tried in order: ${c.openrouterModels.trying.map(esc).join(', ')}</p>` : '';
  return `<div class="enginecheck">${rows}${gm}${or}<p class="hint">Checked ${new Date(c.at).toLocaleTimeString()}. A check doesn’t use your daily AI recipes.</p></div>`;
}

// AI answer -> editable draft (the same review screen as imports).
function aiToDraft(rec, engine, model, parent) {
  const seen = new Set();
  const ingredients = rec.ingredients.map((i) => {
    let id = (i.id || 'i').replace(/[^\w-]/g, '') || 'i';
    while (seen.has(id)) id += '2';
    seen.add(id);
    const ing = { id, qty: i.qty, unit: i.unit || '', item: i.item, prep: i.prep || '' };
    if (i.qty2 != null) ing.qty2 = i.qty2;
    if (i.loose) ing.loose = i.loose;
    if (i.qty == null && !i.loose) { ing.missing = true; ing.note = 'The AI chef left this amount out'; }
    return ing;
  });
  const sid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    id: 'r' + Date.now().toString(36), title: rec.title, servings: rec.servings || 4, servingsLabel: rec.servingsLabel || 'servings',
    time: rec.time || {}, equipment: rec.equipment || [], lanes: rec.lanes?.length ? rec.lanes : [{ id: 'A', name: 'Main' }],
    ingredients,
    steps: rec.steps.map((s) => ({ id: sid(), lane: s.lane, text: s.text, merges: s.merges || [], timer: s.timer || null, wait: !!s.wait })),
    tips: rec.tips || [],
    source: { platform: 'ai', creator: `AI chef · ${{ claude: 'Claude', groq: 'Groq', gemini: 'Gemini', cerebras: 'Cerebras', openrouter: 'OpenRouter' }[engine] || 'AI'}`, url: '', model },
    cooked: 0, created: Date.now(), image: null, ...(parent ? { parent } : {}),
  };
}

async function runAI(extra = {}) {
  const a = db.ai;
  const prompt = (extra.prompt ?? session.aiPrompt ?? '').trim();
  if (!prompt) { session.aiError = 'Say what you’d like to make first.'; return rerender(); }
  session.aiBusy = true; session.aiError = null;
  if (!extra.base) rerender(); else toast('✨ The AI chef is reworking it…');
  try {
    const res = await callFunction('bitrecipe-ai', {
      prompt, engine: a.engine, servings: extra.base ? undefined : a.servings, time: extra.base ? undefined : a.time,
      diet: a.diet, units: db.prefs.system === 'orig' ? null : db.prefs.system,
      have: a.useFridge && !extra.base ? db.fridge?.have || [] : [], base: extra.base,
    });
    const draft = aiToDraft(res.recipe, res.engine, res.model, extra.parent);
    session.draft = draft; session.editing = null; session.writing = false;
    session.flags = [
      { level: 'good', text: `✨ Made by the AI chef (${{ claude: 'Claude', groq: 'Groq', gemini: 'Gemini', cerebras: 'Cerebras', openrouter: 'OpenRouter' }[res.engine] || 'AI'}). Check it over, change anything you like, then save.` },
      ...(typeof res.remaining === 'number' ? [{ level: 'info', text: `${res.remaining} AI recipe${res.remaining === 1 ? '' : 's'} left today.` }] : []),
    ];
    db.stats.ai = (db.stats.ai || 0) + 1; save();
    session.aiBusy = false;
    go('#/review');
  } catch (e) {
    session.aiBusy = false; session.aiError = e.message;
    refreshEngines(true);
    if (extra.base) toast(e.message); else rerender();
  }
}

function listView() {
  const g = db.grocery;
  const sections = buildList(db.recipes, g.entries, g.manual, db.prefs.system);
  const total = sections.reduce((a, s) => a + s.lines.length, 0);
  const done = sections.reduce((a, s) => a + s.lines.filter((l) => g.checked[l.key]).length, 0);
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">GROCERY LIST</div>${total ? '<button class="icon-btn" id="shareList" aria-label="Share list">⇪</button>' : ''}</header>
  <main>
    ${g.entries.length ? `<div class="panel"><div class="h">COOKING</div><div class="chips">${g.entries.map((e) => {
      const r = byId(e.rid);
      return r ? `<span class="chip lchip"><a href="#/r/${esc(r.id)}">${esc(r.title)}</a> · ${e.servings} ${esc(r.servingsLabel || 'servings')}${e.skip?.length ? ` · ${e.skip.length} you have` : ''} <button data-unlist="${esc(e.rid)}" aria-label="Remove">✕</button></span>` : '';
    }).join('')}</div></div>` : `<div class="panel empty">${chef(48)}<p style="margin-top:10px">Your list is empty.<br>Tap 🛒 on recipes you want to cook, and everything you still need lands here, merged and sorted by aisle.</p></div>`}
    ${total ? `<div class="quest" style="margin-bottom:14px"><i style="width:${Math.round((done / total) * 100)}%"></i></div>` : ''}
    ${sections.map((sec) => `<div class="panel"><div class="h">${esc(sec.aisle.toUpperCase())}</div><ul class="checklist">${sec.lines.map((l) => `
      <li data-gcheck="${esc(l.key)}" class="${g.checked[l.key] ? 'on' : ''}"><span class="box">${g.checked[l.key] ? '✓' : ''}</span><span class="txt">
        ${l.amount ? `<b class="amt${l.missing ? ' missing' : ''}">${esc(l.amount)}</b> ` : ''}${esc(l.item)}<span class="ingnote">${esc(l.from.join(' · '))}</span></span>
        ${l.manual ? `<button class="x pill" data-unmanual="${esc(l.manual)}">✕</button>` : ''}</li>`).join('')}</ul></div>`).join('')}
    <div class="panel">
      <div class="h">+ ADD SOMETHING ELSE</div>
      <div class="row"><input class="field grow" id="manualItem" placeholder="Paper towels, coffee…"><button class="btn" id="addManual">ADD</button></div>
    </div>
    ${total ? `<div class="row"><button class="btn ghost grow" id="clearChecked">CLEAR TICKED</button><button class="btn ghost grow" id="clearList">CLEAR ALL</button></div>` : ''}
  </main>`;
}

function badgesView() {
  const L = levelOf(db.xp || 0);
  const got = db.badges || {};
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">BADGES</div></header>
  <main>
    ${levelBar()}
    <div class="badges">${BADGES.map((b) => `<div class="badge${got[b.id] ? ' got' : ''}">${trophy(32)}<b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('')}</div>
    <p class="small muted" style="text-align:center;margin-top:16px">XP: cook a recipe +${XP.cook} · save a recipe +${XP.save} · write your own +${XP.write} · make your own version +${XP.version} · start a grocery list +${XP.grocery}<br>Level ${L.level}: ${esc(L.title)}</p>
  </main>`;
}

function themeView() {
  const cur = theme();
  const report = contrastReport(cur);
  return `
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">COLOURS</div></header>
  <main>
    <div class="panel"><div class="logo-big">${logoSvg({ size: 128 })}</div><p class="small muted" style="text-align:center">The logo and every screen follow your colours.</p></div>
    <div class="panel">
      <div class="h">PRESETS</div>
      <div class="presets">${Object.entries(PRESETS).map(([k, p]) => `
        <button class="preset${!db.theme.custom && db.theme.preset === k ? ' on' : ''}" data-preset="${k}" style="background:${p.bg};color:${p.ink};border-color:${p.edge}">
          <div class="sws">${['accent', 'accent2', 'lane1', 'lane2', 'lane3'].map((t) => `<i style="background:${p[t]}"></i>`).join('')}</div><span>${esc(p.name)}</span>
        </button>`).join('')}</div>
    </div>
    <div class="panel">
      <div class="h">MAKE YOUR OWN${db.theme.custom ? ' · CUSTOM ON' : ''}</div>
      <div class="colors">${TOKENS.map(([k, label]) => `<label><input type="color" data-color="${k}" value="${cur[k]}">${esc(label)}</label>`).join('')}</div>
      <div style="margin-top:14px">${report.map((c) => `<div class="cr"><span>${c.label}</span><b class="${c.ok ? 'ok' : 'no'}">${c.ratio.toFixed(1)}:1 ${c.ok ? '✓' : '✗ hard to read'}</b></div>`).join('')}</div>
      <div class="row" style="margin-top:12px">
        ${report.some((c) => !c.ok) ? '<button class="btn alt grow" id="fixc">FIX READABILITY</button>' : ''}
        ${db.theme.custom ? '<button class="btn ghost grow" id="resetc">BACK TO PRESET</button>' : ''}
      </div>
    </div>
  </main>`;
}

// ---------- cook mode ----------
let voice = null;
const stepSpeech = (r, s) => plainStep(s.text, r, ctxFor(r)) + (s.timer ? `. Say "start timer" for ${s.timer.min} minutes.` : '');
function getVoice() {
  voice ||= createVoice(BitNative, {
    onState: () => document.querySelectorAll('#voiceBtn').forEach((b) => b.classList.toggle('on', voice.on)),
    onCommand: (cmd) => {
      const c = session.cook; const r = byId(c?.id);
      if (!c || !r) return;
      const s = r.steps[c.i];
      const tap = (id) => document.getElementById(id)?.click();
      if (cmd === 'next' || (cmd === 'finish' && c.i === r.steps.length - 1)) tap('next');
      else if (cmd === 'back') tap('prev');
      else if (cmd === 'repeat' && s) voice.say(stepSpeech(r, s));
      else if (cmd === 'timer' && s?.timer) { startTimer(r, s.id); voice.say(`${s.timer.label} timer started, ${s.timer.min} minutes.`); }
      else if (cmd === 'stop') { timers.filter((t) => t.end <= Date.now()).forEach(stopTimer); voice.hush(); }
      else if (cmd === 'ingredients' && s) {
        const used = [...s.text.matchAll(/\{([\w-]+)(?:\*([\d.]+))?\}/g)].map((m) => plainStep(m[0], r, ctxFor(r)));
        voice.say(used.length ? 'You need ' + used.join(', ') : 'This step uses nothing new.');
      }
      toast(`🎙 “${cmd}”`);
    },
  });
  return voice;
}
async function toggleVoice() {
  const v = getVoice();
  try {
    if (v.on) { await v.stop(); toast('Hands-free off'); return; }
    await v.start();
    toast('🎙 Listening: say NEXT, BACK, REPEAT, TIMER, STOP');
    const c = session.cook; const r = byId(c?.id);
    if (db.prefs.readAloud !== false && r?.steps[c.i]) { c.spoken = c.i; v.say(stepSpeech(r, r.steps[c.i])); }
  } catch (e) { toast(e.message || 'Microphone not available'); }
}

function openCook(r) {
  session.cook = { id: r.id, i: 0, finished: false };
  keepAwake(true);
  renderCook();
}
function closeCook() {
  session.cook = null;
  if (voice?.on) voice.stop();
  voice?.hush();
  keepAwake(false);
  document.querySelector('.cook')?.remove();
}
function renderCook() {
  const c = session.cook;
  const r = byId(c?.id);
  document.querySelector('.cook')?.remove();
  if (!r) return;
  const ctx = ctxFor(r);
  const el = document.createElement('div');
  el.className = 'cook';
  if (c.finished) {
    el.innerHTML = `<div class="stage win">${logoSvg({ size: 96 })}<div class="xp">QUEST<br>COMPLETE<br>+<span id="xpn">0</span> XP</div><p class="muted">${esc(r.title)} · cooked ${r.cooked}×</p></div>
      <button class="btn block" id="cookClose">BACK TO RECIPE</button>`;
    confetti();
    // count the XP up like an arcade score
    let n = 0;
    const up = setInterval(() => { n += 5; const el = document.getElementById('xpn'); if (!el || n > 50) return clearInterval(up); el.textContent = n; }, 60);
  } else {
    const s = r.steps[c.i];
    const k = laneIndex(r).indexOf(s.lane) + 1;
    const pct = Math.round((c.i / r.steps.length) * 100);
    const running = timers.filter((t) => t.recipe === r.id && t.end > Date.now()).map((t) => t.label);
    el.innerHTML = `
      <div class="bar"><button class="icon-btn" id="cookClose" aria-label="Close">✕</button><div class="quest"><i style="width:${pct}%"></i></div><span class="px" style="font-size:10px">${c.i + 1}/${r.steps.length}</span>
        <button class="icon-btn${voice?.on ? ' on' : ''}" id="voiceBtn" aria-label="Hands-free voice control">🎙</button><button class="icon-btn${db.prefs.readAloud !== false ? ' on' : ''}" id="readBtn" aria-label="Read steps aloud">🔊</button></div>

      <div class="stage ${c.dir || ''}">
        <div class="where"><span class="tag lane-${k}">${esc(s.lane)} · ${esc(laneName(r, s.lane))}</span>${s.wait ? `<span class="pill off">${flame(12)} hands-off</span>` : ''}
          ${(s.merges || []).map((m) => `<span class="pill">⤵ ${esc(laneName(r, m))} joins</span>`).join('')}</div>
        <div class="bigtext">${renderText(s.text, r, ctx)}</div>
        ${s.timer ? `<button class="btn alt" data-timer="${esc(s.id)}">⏱ START ${esc(s.timer.label.toUpperCase())} · ${minutesText(s.timer.min)}</button>` : ''}
        ${running.length ? `<p class="small muted">Still going: ${running.map(esc).join(', ')}</p>` : ''}
      </div>
      ${voice?.on ? '<div class="listening"><i></i><i></i><i></i> Listening · say <b>NEXT</b>, <b>BACK</b>, <b>REPEAT</b>, <b>TIMER</b>, <b>STOP</b></div>' : ''}
      <div class="nav"><button class="btn ghost" id="prev" ${c.i === 0 ? 'disabled' : ''}>◀ BACK</button><button class="btn good" id="next">${c.i === r.steps.length - 1 ? '★ FINISH' : 'DONE ▶'}</button></div>`;
  }
  document.body.append(el);
  if (voice?.on && db.prefs.readAloud !== false && !c.finished && c.spoken !== c.i) { c.spoken = c.i; voice.say(stepSpeech(r, r.steps[c.i])); }
  if (c.finished && voice?.on) voice.say('Quest complete! Plus fifty X P.');
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'cookClose') return closeCook(), render();
    if (t.id === 'voiceBtn') return toggleVoice().then(renderCook);
    if (t.id === 'readBtn') { db.prefs.readAloud = db.prefs.readAloud === false; save(); if (db.prefs.readAloud) getVoice().say(stepSpeech(r, r.steps[c.i])); else voice?.hush(); return renderCook(); }
    if (t.id === 'prev') { c.i = Math.max(0, c.i - 1); c.dir = 'back'; return renderCook(); }
    if (t.dataset.timer) return startTimer(r, t.dataset.timer);
    if (t.id === 'next') {
      ctx.done.add(r.steps[c.i].id);
      if (c.i < r.steps.length - 1) { c.i++; c.dir = 'fwd'; return renderCook(); }
      r.cooked = (r.cooked || 0) + 1;
      if (r.lanes.length >= 3) db.stats.threeTrack = (db.stats.threeTrack || 0) + 1;
      setTimeout(() => award(XP.cook, 'cooked'), 1400);
      emit('recipe.cooked', { recipeId: r.id, title: r.title, xp: 50, cookedCount: r.cooked });
      save();
      c.finished = true;
      beep(3);
      renderCook();
    }
  });
}

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const cols = ['var(--accent)', 'var(--accent2)', 'var(--lane1)', 'var(--lane3)', 'var(--good)'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = cols[i % cols.length];
    p.style.animationDelay = Math.random() * 0.6 + 's';
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2600);
}

// ---------- named timers ----------
// In the Android app each timer is also a real alarm (BitNative.scheduleTimer):
// it rings with the alarm sound even when bitrecipe is closed, the screen is
// off, or Do Not Disturb is on. The chips here are the in-app view of them.
const timers = (db.timers || []).filter((t) => !t.dismissed && t.end > Date.now() - 10 * 60000);
const saveTimers = () => { db.timers = timers.filter((t) => !t.dismissed); save(); };

async function ensureAlerts() {
  if (!BitNative) return true;
  try {
    let st = await BitNative.alertStatus();
    if (!st.notifications) {
      toast('Allow notifications so timers can ring when the app is closed');
      st = await BitNative.requestNotifications();
    }
    if (st.notifications && !db.prefs.dndAsked && !st.dnd) {
      db.prefs.dndAsked = true; save();
      setTimeout(() => toast('Tip: Settings ⚙ › Timer alerts lets timers ring through Do Not Disturb'), 2800);
    }
    return st.notifications;
  } catch { return false; }
}

async function startTimer(r, stepId) {
  const s = r.steps.find((x) => x.id === stepId);
  if (!s?.timer) return;
  if (timers.some((t) => t.step === stepId && t.end > Date.now() && !t.dismissed)) return toast('That timer is already running');
  const t = { id: Math.random().toString(36).slice(2), nid: Math.floor(Math.random() * 2e9), recipe: r.id, title: r.title, step: stepId, label: s.timer.label, start: Date.now(), end: Date.now() + s.timer.min * 60000, rang: false };
  timers.push(t);
  db.stats.timers = (db.stats.timers || 0) + 1;
  badgeCheck();
  saveTimers();
  toast(`⏱ ${s.timer.label} · ${minutesText(s.timer.min)} started`);
  tick();
  if (BitNative && (await ensureAlerts())) {
    BitNative.scheduleTimer({ id: t.nid, at: t.end, label: t.label, recipe: r.title }).then((res) => {
      if (res && !res.exact) toast('Timer set, but may ring up to a minute late — see Settings ⚙ › Timer alerts');
    }).catch(() => toast('Could not set the alarm; keep bitrecipe open'));
  }
}
function stopTimer(t) {
  t.dismissed = true;
  BitNative?.cancelTimer({ id: t.nid }).catch(() => {});
  saveTimers();
  tick();
}
let audio;
function beep(n = 4) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < n; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = i % 2 ? 660 : 880;
      g.gain.value = 0.08;
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + i * 0.18); o.stop(audio.currentTime + i * 0.18 + 0.12);
    }
    navigator.vibrate?.([200, 100, 200]);
  } catch { /* no audio */ }
}
let tickHandle;
function tick() {
  clearTimeout(tickHandle);
  const box = document.getElementById('timers');
  const now = Date.now();
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].dismissed) timers.splice(i, 1);
  box.innerHTML = timers.map((t) => {
    const left = Math.max(0, t.end - now);
    // the native alarm rings in the Android app; the browser preview beeps instead
    if (!left && !t.rang) { t.rang = true; if (!BitNative) beep(); saveTimers(); }
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const pct = t.start ? Math.min(100, ((now - t.start) / (t.end - t.start)) * 100) : 0;
    return `<div class="tchip${left ? '' : ' ring'}"><span class="pot${left ? ' boil' : ''}"></span>${esc(t.label.toUpperCase())} ${left ? `${m}:${String(s).padStart(2, '0')}` : 'DONE!'}<button data-stop="${t.id}" aria-label="Stop">✕</button><i class="tprog" style="width:${pct}%"></i></div>`;
  }).join('');
  if (timers.length) tickHandle = setTimeout(tick, 500);
}
document.getElementById('timers').addEventListener('click', (e) => {
  const id = e.target.closest('[data-stop]')?.dataset.stop;
  const t = timers.find((x) => x.id === id);
  if (t) stopTimer(t);
});
if (timers.length) tick();

// ---------- import flow ----------
async function runImport(input) {
  const text = input.trim();
  if (!text) return toast('Paste a link or some recipe text first');
  const box = document.getElementById('importing');
  if (box) box.innerHTML = `<div class="loading"><div class="runway">${chef(40)}</div><div class="loadbar"><i></i></div><span class="px small">READING</span></div>`;
  try {
    const { recipe, flags } = await importAnything(text);
    const caught = recipe.importDebug?.input;
    recipe.importDebug = { ...(recipe.importDebug || {}), input: (caught && caught !== text ? `${text}\n\n--- caption read from the link ---\n${caught}` : text).slice(0, 6000) };
    session.draft = recipe;
    session.flags = flags;
    session.pendingInput = '';
    session.editing = null; session.writing = false;
    go('#/review');
  } catch (err) {
    if (box) box.innerHTML = `<div class="flag bad" style="margin-top:12px">${esc(err.message || 'Could not read that.')}</div>`;
  }
}

// Android share sheet -> bitrecipe
if (BitNative) {
  const takeShare = async () => {
    try {
      const { text } = await BitNative.takeShared();
      if (text) { closeCook(); session.pendingInput = text; go('#/add'); setTimeout(() => runImport(text), 50); }
    } catch { /* nothing shared */ }
  };
  BitNative.addListener('shared', takeShare);
  takeShare();
}

// ---------- router + events ----------
function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  let html = '';
  if (route === 'add') html = addView();
  else if (route === 'review') html = reviewView();
  else if (route === 'theme') html = themeView();
  else if (route === 'list') html = listView();
  else if (route === 'fridge') html = fridgeView();
  else if (route === 'ai') { html = aiView(); refreshEngines(); }
  else if (route === 'f' && findFamilyRecipe(db, arg)) html = recipeView(findFamilyRecipe(db, arg));
  else if (route === 'badges') html = badgesView();
  else if (route === 'settings') { html = settingsView(); if (!session.alerts) refreshAlerts(); }
  else if (route === 'r' && byId(arg)) html = recipeView(byId(arg));
  else if (route === 'edit' && byId(arg)) {
    if (session.editing !== arg) {
      session.draft = structuredClone(byId(arg));
      session.flags = [{ level: 'info', text: 'Editing — your changes replace this recipe when you save.' }];
      session.editing = arg;
    }
    html = reviewView();
  } else html = libraryView();
  $app.innerHTML = html;
  if (route !== 'review' && route !== 'edit') window.scrollTo(0, 0);
}
let lastRoute = '';
let enterT;
window.addEventListener('hashchange', () => {
  const route = location.hash.split('/')[1] || '';
  if (!['review', 'edit'].includes(route)) { session.editing = null; session.writing = false; }
  const keepScroll = route === lastRoute;
  lastRoute = route;
  const y = window.scrollY;
  render();
  if (keepScroll) window.scrollTo(0, y);
  else { document.body.classList.add('enter'); clearTimeout(enterT); enterT = setTimeout(() => document.body.classList.remove('enter'), 900); }
});

function rerender() { const y = window.scrollY; document.body.classList.remove("enter"); render(); window.scrollTo(0, y); }

$app.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    session.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = document.getElementById('search');
    s.focus(); s.setSelectionRange(pos, pos);
  }
  if (e.target.id === 'fq') {
    session.fq = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.getElementById('fq'); el.focus(); el.setSelectionRange(pos, pos);
  }
  if (e.target.dataset.color) {
    db.theme.custom = { ...theme(), [e.target.dataset.color]: e.target.value };
    paint(db.theme.custom);
    save();
  }
});
$app.addEventListener('change', (e) => {
  if (e.target.dataset.color) rerender();
  if (e.target.id === 'staples') { db.fridge.staples = e.target.checked; save(); rerender(); }
});

$app.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-open], [data-have], [data-step], [data-gcheck], a');
  if (!t) return;
  const d = t.dataset;
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const r = route === 'r' ? byId(arg) : route === 'f' ? findFamilyRecipe(db, arg) : null;

  if ('back' in d) return history.length > 1 ? history.back() : go('#/');
  if (d.go) return go(d.go);
  if (d.open) return go(d.open.startsWith('f:') ? '#/f/' + d.open.slice(2) : '#/r/' + d.open);
  if (d.filter) { session.filter = d.filter; return rerender(); }
  if (t.id === 'writeNew') return startWriting();
  if (route === 'ai') {
    db.ai ||= { engine: 'claude', diet: '', servings: 4, time: '', useFridge: false };
    const keepForm = () => {
      session.aiPrompt = document.getElementById('aiPrompt')?.value ?? session.aiPrompt;
      db.ai.servings = Math.max(1, parseInt(document.getElementById('aiServ')?.value, 10) || db.ai.servings);
      db.ai.time = document.getElementById('aiTime')?.value ?? db.ai.time;
      db.ai.diet = (document.getElementById('aiDiet')?.value ?? db.ai.diet).trim();
      db.ai.useFridge = !!document.getElementById('aiFridge')?.checked;
    };
    if (d.idea) { keepForm(); session.aiPrompt = d.idea; return rerender(); }
    if (d.engine) { keepForm(); db.ai.engine = d.engine; save(); return rerender(); }
    if (t.id === 'aiGo') { keepForm(); save(); return runAI(); }
    if (t.id === 'aiRecheck') { toast('Checking the 128bit server…'); return refreshEngines(true); }
    if (t.id === 'aiCheck') {
      keepForm(); session.aiChecking = true; rerender();
      try {
        const r = await callFunction('bitrecipe-ai', { check: true }, { timeoutMs: 100000 });
        session.aiCheck = { ...r.check, at: Date.now() };
        session.aiEngines = Object.fromEntries(Object.entries(r.check).filter(([, v]) => v && typeof v.set === 'boolean').map(([k, v]) => [k, v.set]));
        const good = Object.values(r.check).filter((v) => v?.ok).length;
        toast(good ? `${good} engine${good > 1 ? 's' : ''} working` : 'No engine worked. See the details below');
      } catch (err) { toast(err.message); }
      session.aiChecking = false; return rerender();
    }
  }

  // what can I make
  if (route === 'fridge') {
    db.fridge ||= { have: [], staples: true };
    if (d.haveK) { const h = new Set(db.fridge.have); h.has(d.haveK) ? h.delete(d.haveK) : h.add(d.haveK); db.fridge.have = [...h]; save(); return rerender(); }
    if (t.id === 'fridgeClear') { db.fridge.have = []; save(); return rerender(); }
    if (d.cartmissing) {
      const rr = byId(d.cartmissing); const h = new Set(db.fridge.have);
      addToList(rr, rr.ingredients.filter((i) => h.has(keyOf(i.item)) || (db.fridge.staples && STAPLES.includes(keyOf(i.item)))).map((i) => i.id));
      save(); return rerender();
    }
  }

  // add screen
  if (t.id === 'go') return runImport(document.getElementById('src').value);
  if (t.id === 'trysample') { document.getElementById('src').value = SAMPLE_CAPTION; return; }
  if (t.id === 'paste') {
    return navigator.clipboard?.readText?.().then((txt) => { document.getElementById('src').value = txt; }).catch(() => toast('Long-press the box and choose Paste'));
  }

  // review screen
  const dr = session.draft;
  if (dr && (route === 'review' || route === 'edit')) {
    if (d.lane) { syncDraft(); const [sid, lid] = d.lane.split(':'); const s = dr.steps.find((x) => x.id === sid); s.lane = lid; s.merges = (s.merges || []).filter((m) => m !== lid); return rerender(); }
    if (d.join) { syncDraft(); const [sid, lid] = d.join.split(':'); const s = dr.steps.find((x) => x.id === sid); s.merges = s.merges?.includes(lid) ? s.merges.filter((m) => m !== lid) : [...(s.merges || []), lid]; return rerender(); }
    if (d.delstep != null) { syncDraft(); dr.steps.splice(+d.delstep, 1); return rerender(); }
    if (d.deling != null) { syncDraft(); dr.ingredients.splice(+d.deling, 1); return rerender(); }
    if (t.id === 'addIng') { syncDraft(); dr.ingredients.push({ id: 'i' + Date.now().toString(36), qty: null, unit: '', item: '', raw: '', edited: true }); return rerender(); }
    if (t.id === 'addStep') { syncDraft(); dr.steps.push({ id: 's' + Date.now().toString(36), lane: dr.steps.at(-1)?.lane || dr.lanes[0].id, text: '', merges: [] }); return rerender(); }
    if (t.id === 'addLane') { syncDraft(); const id = ['A', 'B', 'C'].find((l) => !dr.lanes.some((x) => x.id === l)); dr.lanes.push({ id, name: `Track ${id}` }); return rerender(); }
    if (t.id === 'report') { syncDraft(); return shareOut(importReport(finalize(structuredClone(dr), true)), 'bitrecipe import report'); }
    if (t.id === 'photoOut') { syncDraft(); delete dr.photo; delete dr.photoV; dr.image = null; return rerender(); }
    if (t.id === 'saveDraft') {
      syncDraft();
      if (!dr.title || dr.title === 'Untitled recipe') { if (session.writing) { toast('Give your recipe a name first'); document.querySelector('[data-f=title]')?.focus(); return; } }
      const shareAfter = !!document.getElementById('alsoFamily')?.checked;
      const rec = finalize(structuredClone(dr));
      rec.ingredients.forEach((i) => { delete i.edited; });
      delete rec.needsReview; delete rec.reviewFlags;
      const idx = db.recipes.findIndex((x) => x.id === rec.id);
      if (idx >= 0) db.recipes[idx] = rec; else { db.recipes.unshift(rec); emit('recipe.saved', { recipeId: rec.id, title: rec.title, platform: rec.source?.platform }); setTimeout(() => award(XP.save, 'saved'), 600); }
      ensurePhoto(rec);
      if (!session.editing) emit('recipe.scraped', { recipeId: rec.id, platform: rec.source?.platform });
      save();
      const wrote = session.writing;
      session.draft = null; session.editing = null; session.writing = false;
      if (wrote) { db.stats.written = (db.stats.written || 0) + 1; setTimeout(() => award(XP.write, 'wrote'), 900); }
      if (shareAfter && db.family?.books?.[0]) shareToBook(db, db.family.books[0].id, rec).then(() => { save(); toast(`👪 Also shared to ${db.family.books[0].name}`); }).catch((e) => toast(e.message));
      else toast('Saved to your cookbook');
      return location.replace('#/r/' + rec.id);
    }
  }

  // recipe screen
  if (r) {
    if (d.serv) {
      const cur = session.servings[r.id] || r.servings;
      session.servings[r.id] = d.serv === 'reset' ? r.servings : Math.max(1, cur + +d.serv);
      return rerender();
    }
    if (d.sys) { db.prefs.system = d.sys; save(); return rerender(); }
    if (d.view) { db.prefs.view = d.view; save(); return rerender(); }
    if (d.timer) return startTimer(r, d.timer);
    if (d.have) { const h = (session.have[r.id] ||= new Set()); h.has(d.have) ? h.delete(d.have) : h.add(d.have); return rerender(); }
    if (d.step && !e.target.closest('a')) { const s = ctxFor(r).done; s.has(d.step) ? s.delete(d.step) : s.add(d.step); return rerender(); }
    if (t.id === 'cook') return openCook(r);
    if (t.id === 'shareCard') return shareCard(r);
    if (t.id === 'aiTweak') {
      if (!signedIn()) { toast('Sign in to your 128bit account to use the AI chef'); return go('#/settings'); }
      db.ai ||= { engine: 'claude', diet: '', servings: 4, time: '', useFridge: false };
      const ask = prompt('How should the AI chef change this recipe?\n(e.g. make it vegetarian, double the sauce, no oven, gluten-free)');
      if (!ask?.trim()) return;
      const base = { title: r.title, servings: r.servings, ingredients: r.ingredients.map((i) => ({ id: i.id, qty: i.qty, qty2: i.qty2 ?? null, unit: i.unit, item: i.item, prep: i.prep || '', loose: i.loose || null })), lanes: r.lanes, steps: r.steps.map((s) => ({ lane: s.lane, text: s.text, merges: s.merges || [], timer: s.timer || null, wait: !!s.wait })), tips: r.tips || [] };
      return runAI({ prompt: ask, base, parent: r._shared ? undefined : r.id });
    }
    if (t.id === 'fav') { r.fav = !r.fav; save(); if (r.fav) toast('★ Added to favourites'); return rerender(); }
    if (d.tag) { const tg = new Set(r.tags || []); tg.has(d.tag) ? tg.delete(d.tag) : tg.add(d.tag); r.tags = [...tg]; save(); return rerender(); }
    if (t.id === 'newTag') { const n = (prompt('New collection name (e.g. Holiday, Mum’s)') || '').trim().slice(0, 20); if (n) { r.tags = [...new Set([...(r.tags || []), n])]; save(); rerender(); } return; }
    if (t.id === 'toFamily') return shareFamily(r);
    if (t.id === 'saveShared') {
      const copy = structuredClone(r);
      for (const k of ['_shared', '_book', '_bookName', '_by', '_updated']) delete copy[k];
      copy.id = 'r' + Date.now().toString(36); copy.cooked = 0; copy.created = Date.now();
      copy.source = { ...(copy.source || {}), via: 'family' };
      db.recipes.unshift(copy); save(); award(XP.save, 'saved');
      toast('Saved to your cookbook'); return location.replace('#/r/' + copy.id);
    }
    if (t.id === 'toList') { addToList(r, [...(session.have[r.id] || [])].filter((k) => !k.startsWith('prep-')), ctxFor(r).servings); save(); return rerender(); }
    if (t.id === 'report') return shareOut(importReport(r), 'bitrecipe import report');
    if (t.id === 'looksGood') { delete r.needsReview; delete r.reviewFlags; save(); toast('Saved for good'); return rerender(); }
    if (t.id === 'dup') {
      const copy = structuredClone(r);
      copy.id = 'r' + Date.now().toString(36);
      copy.title = `${r.title} (my version)`;
      copy.parent = r.id; copy.cooked = 0; delete copy.sample; delete copy.importDebug;
      setTimeout(() => award(XP.version, 'version'), 600);
      db.recipes.unshift(copy); save();
      toast('Copy made — edit away, the original stays as it was');
      return go('#/edit/' + copy.id);
    }
    if (t.id === 'del') {
      if (!confirm(`Delete “${r.title}”?`)) return;
      db.recipes = db.recipes.filter((x) => x.id !== r.id); save();
      return location.replace('#/');
    }
  }

  // anywhere
  if (d.update != null && session.update) return openExternal(session.update.url);
  if (d.cart) {
    e.stopPropagation();
    const rr = byId(d.cart);
    const g = db.grocery;
    if (g.entries.some((x) => x.rid === rr.id)) { g.entries = g.entries.filter((x) => x.rid !== rr.id); toast('Removed from the list'); }
    else addToList(rr, []);
    save(); return rerender();
  }
  if (t.tagName === 'A' && /^https?:/.test(t.getAttribute('href') || '') && BitNative) { e.preventDefault(); return openExternal(t.href); }

  // grocery list
  if (route === 'list') {
    const g = db.grocery;
    if (d.gcheck) { g.checked[d.gcheck] = !g.checked[d.gcheck]; save(); return rerender(); }
    if (d.unlist) { g.entries = g.entries.filter((x) => x.rid !== d.unlist); save(); return rerender(); }
    if (d.unmanual) { g.manual = g.manual.filter((x) => x.id !== d.unmanual); save(); return rerender(); }
    if (t.id === 'addManual') {
      const v = document.getElementById('manualItem').value.trim();
      if (!v) return;
      g.manual.push({ id: Date.now().toString(36), text: v }); save(); return rerender();
    }
    if (t.id === 'clearChecked') {
      const secs = buildList(db.recipes, g.entries, g.manual, db.prefs.system);
      const keys = secs.flatMap((s) => s.lines).filter((l) => g.checked[l.key]);
      g.manual = g.manual.filter((m) => !g.checked['m:' + m.id]);
      // a recipe whose lines are all ticked is done shopping: drop it
      g.entries = g.entries.filter((en) => {
        const r = byId(en.rid);
        return r && secs.flatMap((s) => s.lines).some((l) => !g.checked[l.key] && l.from.includes(r.title));
      });
      keys.forEach((l) => delete g.checked[l.key]);
      save(); return rerender();
    }
    if (t.id === 'clearList') { if (!confirm('Clear the whole list?')) return; db.grocery = { entries: [], manual: [], checked: {} }; save(); return rerender(); }
    if (t.id === 'shareList') return shareOut(listAsText(buildList(db.recipes, g.entries, g.manual, db.prefs.system), g.checked), 'Grocery list');
  }

  // settings screen
  if (d.perm && BitNative) {
    const go = d.perm === 'notifications' ? BitNative.requestNotifications() : d.perm === 'exact' ? BitNative.openExactAlarmSettings() : BitNative.openDndSettings();
    return go.then(refreshAlerts).catch(() => {});
  }
  if (t.id === 'testTimer') {
    const fake = { id: 'test', title: 'Test', steps: [{ id: 'test-step', timer: { min: 10 / 60, label: 'Test' } }] };
    return startTimer(fake, 'test-step');
  }
  if (t.id === 'addBoard') {
    const input = document.getElementById('boardUrl').value;
    const msg = document.getElementById('boardMsg');
    if (!input.trim()) return toast('Paste a board link first');
    msg.innerHTML = '<div class="loading"><div class="loadbar"><i></i></div></div>';
    return resolveBoard(input).then((b) => {
      db.pinterest ||= { boards: [] };
      if (db.pinterest.boards.some((x) => x.feed === b.feed)) throw new Error('Already following that board');
      db.pinterest.boards.push(b); save();
      toast(`Following “${b.name}”`);
      rerender();
      runPinterestSync(true);
    }).catch((err) => { msg.innerHTML = `<div class="flag bad" style="margin-top:10px">${esc(/fetch|network|Failed/i.test(err.message) && !BitNative ? 'The browser preview can’t read Pinterest. Use the Android app.' : err.message)}</div>`; });
  }
  if (d.unboard != null) { db.pinterest.boards.splice(+d.unboard, 1); save(); return rerender(); }
  if (t.id === 'syncNow') return runPinterestSync(true);
  if (t.id === 'checkUpd') return checkUpdate(true);
  if (['accIn', 'accUp', 'accForgot'].includes(t.id)) {
    const email = document.getElementById('accEmail').value, pass = document.getElementById('accPass').value;
    session.accEmail = email;
    const msg = document.getElementById('accMsg');
    const say = (text, level = 'info') => { msg.innerHTML = `<div class="flag ${level}" style="margin-top:10px">${esc(text)}</div>`; };
    t.disabled = true;
    const work = t.id === 'accIn' ? signIn(email, pass).then(() => 'in')
      : t.id === 'accUp' ? signUp(email, pass).then((r) => (r === 'confirm' ? 'confirm' : 'in'))
      : resetPassword(email).then(() => 'reset');
    return work.then((r) => {
      if (r === 'confirm') return say('Account made! Check your email for the 128bit confirmation link, then come back and sign in.', 'good');
      if (r === 'reset') return say('If that email has an account, a reset link is on its way.', 'good');
      resetSync(db); store();
      toast('Signed in · syncing');
      rerender();
      runSync(true);
    }).catch((err) => { t.disabled = false; say(err.message, 'bad'); });
  }
  if (t.id === 'syncAcc') return runSync(true);
  if (['mkBook', 'joinBook'].includes(t.id) || d.leave || d.sharecode) {
    db.family ||= { books: [], recipes: {}, cursors: {}, name: '' };
    db.family.name = (document.getElementById('famName')?.value || '').trim().slice(0, 40);
    const msg = document.getElementById('famMsg');
    const say = (text, level) => { if (msg) msg.innerHTML = `<div class="flag ${level}" style="margin-top:10px">${esc(text)}</div>`; };
    try {
      if (d.sharecode) return shareOut(`Join my bitrecipe family cookbook “${d.bookname}”: open bitrecipe › Settings › Family cookbook and enter code ${d.sharecode}`, 'Family cookbook invite');
      if (d.leave) { if (!confirm('Leave this cookbook? Your own recipes stay.')) return; await leaveBook(db, d.leave); save(); toast('Left the cookbook'); return rerender(); }
      t.disabled = true;
      if (t.id === 'mkBook') { const b = await createBook(db, document.getElementById('bookName').value); save(); toast(`Made “${b.name}” · code ${b.code}`); }
      else { const code = document.getElementById('bookCode').value; if (!code.trim()) { t.disabled = false; return say('Type the 6-letter code first.', 'warn'); } const b = await joinBook(db, code); save(); toast(`Joined “${b.name}”`); }
      return rerender();
    } catch (err) {
      t.disabled = false;
      return say(/does not exist|schema cache|bitrecipe_books|bitrecipe_create_book|bitrecipe_join_book|isn’t set up/i.test(err.message) ? 'The 128bit server isn’t set up for family cookbooks yet (run supabase/bitrecipe-family.sql).' : err.message, 'bad');
    }
  }
  if (d.feed) { db.prefs.shareFeed = d.feed === '1'; if (db.prefs.shareFeed) db.prefs.shareFeedFrom = Date.now(); save(); rerender(); if (db.prefs.shareFeed) runSync(); return; }
  if (t.id === 'signOut') {
    if (!confirm('Sign out? Your recipes stay on this phone.')) return;
    await signOut(); resetSync(db); store(); toast('Signed out'); return rerender();
  }
  if (t.id === 'wipeServer') {
    if (!confirm('Remove all your bitrecipe data from the 128bit server? This phone keeps its copy; other devices stop getting updates.')) return;
    try { const n = await api('rpc/bitrecipe_wipe', { method: 'POST', body: {} }); resetSync(db); store(); toast(`Removed ${n} items from the server`); } catch (err) { toast(err.message); }
    return rerender();
  }
  if (t.id === 'backup') return saveBackup();
  if (d.motion) { db.prefs.motion = d.motion === '1'; save(); setMotion(); return rerender(); }

  // theme screen
  if (d.preset) { db.theme = { preset: d.preset, custom: null }; paint(theme()); save(); return rerender(); }
  if (t.id === 'fixc') { db.theme.custom = fixContrast(theme()); paint(db.theme.custom); save(); return rerender(); }
  if (t.id === 'resetc') { db.theme.custom = null; paint(theme()); save(); return rerender(); }
});

// Keyboard: when a box is focused, hide the bottom button bar (it would sit
// on top of the keyboard) and keep the box in view as the app shrinks.
const isTyping = () => document.activeElement?.matches?.('input:not([type=checkbox]):not([type=color]), textarea, select');
document.addEventListener('focusin', () => {
  if (!isTyping()) return;
  document.body.classList.add('typing');
  setTimeout(() => document.activeElement?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300);
});
document.addEventListener('focusout', () => setTimeout(() => { if (!isTyping()) document.body.classList.remove('typing'); }, 50));
window.addEventListener('resize', () => { if (isTyping()) document.activeElement.scrollIntoView({ block: 'center' }); });

document.addEventListener('keydown', (e) => {
  if (!session.cook) return;
  if (e.key === 'ArrowRight') document.getElementById('next')?.click();
  if (e.key === 'ArrowLeft') document.getElementById('prev')?.click();
  if (e.key === 'Escape') document.getElementById('cookClose')?.click();
});

function startWriting() {
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  session.draft = {
    id: 'r' + id(), title: '', servings: 4, servingsLabel: 'servings', time: { active: null, total: null },
    source: { platform: 'mine', creator: db.family?.name || '', url: '' },
    equipment: [], lanes: [{ id: 'A', name: 'Main' }],
    ingredients: [0, 1, 2].map(() => ({ id: 'i' + id(), qty: null, unit: '', item: '', raw: '', edited: true })),
    steps: [0, 1].map(() => ({ id: 's' + id(), lane: 'A', text: '', merges: [] })),
    cooked: 0, created: Date.now(), image: null,
  };
  session.flags = [{ level: 'info', text: '✍ Your recipe, your way. Fill in what you know. You can always edit it later.' }];
  session.editing = null; session.writing = true;
  go('#/review');
}

async function shareCard(r) {
  toast('Drawing your recipe card…');
  try {
    const png = await recipeCard(r, ctxFor(r));
    const name = (r.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'recipe') + '.png';
    if (BitNative) { await BitNative.shareImage({ base64: png.split(',')[1], name, title: r.title, text: `${r.title} — made with bitrecipe` }); return; }
    const blob = await (await fetch(png)).blob();
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: r.title }); return; }
    const a = document.createElement('a'); a.href = png; a.download = name; a.click();
    toast('Card downloaded');
  } catch (e) { if (e?.name !== 'AbortError') toast('Couldn’t make the card'); }
}

async function shareFamily(r) {
  const books = db.family?.books || [];
  let book = books[0];
  if (books.length > 1) {
    const pick = prompt('Share to which cookbook?\n' + books.map((b, i) => `${i + 1}. ${b.name}`).join('\n'), '1');
    book = books[(parseInt(pick, 10) || 0) - 1];
    if (!book) return;
  }
  try { await shareToBook(db, book.id, r); save(); toast(`👪 Shared to ${book.name}`); } catch (e) { toast(e.message); }
}

function addToList(r, skip = [], servings) {
  const g = db.grocery;
  const first = !g.entries.length && !g.manual.length;
  const entry = { rid: r.id, servings: servings || r.servings, skip };
  const i = g.entries.findIndex((x) => x.rid === r.id);
  if (i >= 0) g.entries[i] = entry; else g.entries.push(entry);
  const n = r.ingredients.length - skip.length;
  toast(`🛒 ${n} item${n === 1 ? '' : 's'} for ${r.title}${skip.length ? ` (skipped ${skip.length} you have)` : ''}`);
  if (first) { db.stats.lists = (db.stats.lists || 0) + 1; award(XP.grocery, 'grocery'); }
  bumpCart();
}
function bumpCart() {
  const b = document.querySelector('.cartbtn');
  b?.classList.remove('bump'); void b?.offsetWidth; b?.classList.add('bump');
}

async function saveBackup() {
  const data = JSON.stringify({ app: 'bitrecipe', version: VERSION, exported: new Date().toISOString(), db }, null, 1);
  const name = `bitrecipe-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (BitNative) {
    try { await BitNative.saveFile({ name, text: data, mime: 'application/json' }); toast('Backup saved'); } catch (e) { if (!/cancel/i.test(e?.message || '')) toast('Couldn’t save the backup'); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup downloaded');
}
$app.addEventListener('change', async (e) => {
  if (e.target.id === 'photoIn' && e.target.files?.[0] && session.draft) {
    syncDraft();
    const url = URL.createObjectURL(e.target.files[0]);
    toast('Adding photo…');
    const data = await makePhoto(url);
    URL.revokeObjectURL(url);
    if (!data) return toast('Couldn’t read that picture');
    session.draft.photo = data; session.draft.photoV = PHOTO_VERSION; session.draft.image = null;
    return rerender();
  }
  if (e.target.id === 'alsoFamily') { session.alsoFamily = e.target.checked; return; }
  if (e.target.id !== 'restore' || !e.target.files?.[0]) return;
  try {
    const parsed = JSON.parse(await e.target.files[0].text());
    const b = parsed.db || parsed;
    if (!Array.isArray(b.recipes)) throw new Error('not a bitrecipe backup');
    let added = 0, updated = 0;
    for (const r of b.recipes) {
      const i = db.recipes.findIndex((x) => x.id === r.id);
      if (i < 0) { db.recipes.push(r); added++; } else if ((r.cooked || 0) >= (db.recipes[i].cooked || 0)) { db.recipes[i] = r; updated++; }
    }
    db.xp = Math.max(db.xp || 0, b.xp || 0);
    db.badges = { ...(b.badges || {}), ...(db.badges || {}) };
    db.stats = { ...(b.stats || {}), ...db.stats };
    if (b.grocery && !db.grocery.entries.length && !db.grocery.manual.length) db.grocery = b.grocery;
    if (b.pinterest?.boards?.length) { db.pinterest ||= { boards: [] }; for (const bd of b.pinterest.boards) if (!db.pinterest.boards.some((x) => x.feed === bd.feed)) db.pinterest.boards.push(bd); }
    if (b.theme && confirm('Use the colours from the backup too?')) { db.theme = b.theme; paint(theme()); }
    save();
    toast(`Restored: ${added} new, ${updated} updated`);
    rerender();
  } catch (err) { toast('That file isn’t a bitrecipe backup'); }
});

function setMotion() {
  const calm = db.prefs.motion === false || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('calm', calm);
}
setMotion();

// Check followed Pinterest boards on launch and when coming back to the app.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshAlerts();
  runSync();
  const last = Math.min(...(db.pinterest?.boards || []).map((b) => b.last || 0));
  if (Date.now() - last > 15 * 60000) runPinterestSync();
});
setTimeout(() => runPinterestSync(), 1500);
setTimeout(() => runSync(), 800);
if (Date.now() - (db.prefs.updateChecked || 0) > 6 * 3600000) setTimeout(() => checkUpdate(), 2500);
// make pixel photos for any recipe that has an image but no photo yet
setTimeout(() => db.recipes.filter((r) => r.image && !r.photoFailed && (!r.photo || r.photoV !== PHOTO_VERSION)).slice(0, 8).forEach(ensurePhoto), 3000);

render();
