// bitrecipe app shell: library -> import -> review -> recipe -> cook mode.
import { SAMPLES } from './samples.js';
import { importAnything, parseIngredientLine, linkSteps, tokensToMarkers, markersToTokens, guessEquipment, timerFrom } from './parse.js';
import { amountText, itemText, minutesText } from './units.js';
import { renderTrackMap, renderList, renderLegend, renderText, laneIndex, laneName, maxParallel, esc } from './trackmap.js';
import { PRESETS, TOKENS, applyTheme, contrastReport, fixContrast } from './theme.js';
import { logoSvg } from './logo.js';

// ---------- storage ----------
const KEY = 'bitrecipe.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const db = load() || { recipes: structuredClone(SAMPLES), theme: { preset: 'tomato', custom: null }, prefs: { system: 'orig', view: 'map' }, events: [], xp: 0 };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { toast('Storage full — could not save'); } };
save();

// Family event outbox (shared 128bit family_events feed; synced once accounts land).
function emit(type, payload) {
  db.events.push({ type, app: 'bitrecipe', at: new Date().toISOString(), payload });
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
const byId = (id) => db.recipes.find((r) => r.id === id);
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

const srcBadge = (s) => `<span class="src ${esc(s?.platform || 'text')}">${{ tiktok: 'TIKTOK', instagram: 'REELS', web: 'WEB', youtube: 'YT', text: 'TEXT' }[s?.platform] || 'TEXT'}</span>`;

// ---------- screens ----------
function libraryView() {
  const q = (session.search || '').toLowerCase();
  const list = db.recipes.filter((r) => !q || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.item.toLowerCase().includes(q)));
  return `
  <header class="top">
    <div class="brand">${logoSvg({ size: 36 })}<span class="word">bit<i>recipe</i></span></div>
    <button class="icon-btn" data-go="#/theme" aria-label="Colours">🎨</button>
  </header>
  <main>
    <div class="panel">
      <div class="h">▶ NEW QUEST</div>
      <p class="small muted" style="margin-bottom:12px">Share a TikTok, Reel or recipe page to bitrecipe — or paste it here.</p>
      <button class="btn block" data-go="#/add">+ ADD A RECIPE</button>
    </div>
    <div class="row" style="margin-bottom:14px">
      <input class="field grow" id="search" placeholder="Search recipes or ingredients…" value="${esc(session.search || '')}">
    </div>
    <div class="h">COOKBOOK · ${db.recipes.length}</div>
    ${list.length ? list.map((r) => `
      <div class="panel rcard" data-open="${esc(r.id)}">
        <div class="strip"></div>
        <div class="body">
          <h3>${esc(r.title)}</h3>
          <div class="meta">${srcBadge(r.source)}
            ${r.time?.total ? `<span>⏱ ${minutesText(r.time.total)}</span>` : ''}
            <span>⇉ ${r.lanes.length} track${r.lanes.length > 1 ? 's' : ''}</span>
            <span>${r.ingredients.length} items</span>
            ${r.ingredients.some((i) => i.missing && i.qty == null) ? '<span style="color:var(--accent)">?? missing</span>' : ''}
            ${r.cooked ? `<span>★ ${r.cooked}</span>` : ''}
          </div>
        </div>
      </div>`).join('') : '<div class="empty">Nothing here yet.</div>'}
    <p class="small muted" style="text-align:center;margin-top:20px">${db.xp ? `★ ${db.xp} XP earned in the kitchen` : 'Cook a recipe to earn XP for 128bitlife'}</p>
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
  <header class="top"><button class="icon-btn" data-back aria-label="Back">◀</button><div class="title">CHECK IT</div></header>
  <main>
    ${session.flags.map((f) => `<div class="flag ${f.level}">${esc(f.text)}</div>`).join('')}
    <div class="panel">
      <label class="lbl">Title</label><input class="field" data-f="title" value="${esc(d.title)}">
      <div class="row">
        <div class="grow"><label class="lbl">Serves</label><input class="field" type="number" min="1" data-f="servings" value="${esc(d.servings)}"></div>
        <div class="grow"><label class="lbl">Total minutes</label><input class="field" type="number" min="0" data-f="total" value="${esc(d.time?.total || '')}"></div>
      </div>
      <label class="lbl">Creator / source</label><input class="field" data-f="creator" value="${esc(d.source?.creator || '')}">
      ${d.source?.url ? `<p class="hint">Link kept: ${esc(d.source.url)}</p>` : ''}
    </div>
    <div class="panel">
      <div class="h">INGREDIENTS · ONE PER LINE</div>
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
      <p class="hint" style="margin:-4px 0 10px">[brackets] show where an amount appears — it scales with servings.</p>
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
    <div class="panel"><div class="h">PREVIEW</div>${renderLegend(d)}${renderTrackMap(finalize(structuredClone(d), true), { factor: 1, system: 'orig' })}</div>
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
  d.time = { ...(d.time || {}), total: total || null };
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
      <h1 class="rtitle">${esc(r.title)}</h1>
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

    ${missing.length ? `<div class="flag warn">?? ${missing.length} amount${missing.length > 1 ? 's' : ''} missing from the source: ${missing.map((i) => esc(i.item)).join(', ')}. <a href="#/edit/${esc(r.id)}">Fill in</a></div>` : ''}

    ${r.equipment?.length || prepList.length ? `<div class="panel">
      <div class="h">BEFORE YOU START</div>
      ${r.equipment?.length ? `<p class="small muted" style="margin-bottom:6px">Get out:</p><div class="chips" style="margin-bottom:12px">${r.equipment.map((e) => `<span class="chip">${esc(e)}</span>`).join('')}</div>` : ''}
      ${prepList.length ? `<p class="small muted">Prep first:</p><ul class="checklist">${prepList.map((i) => `<li data-have="prep-${esc(i.id)}" class="${have.has('prep-' + i.id) ? 'on' : ''}"><span class="box">${have.has('prep-' + i.id) ? '✓' : ''}</span><span class="txt">${esc(cap(i.item))} <span class="prep">→ ${esc(i.prep)}</span></span></li>`).join('')}</ul>` : ''}
    </div>` : ''}

    <div class="panel">
      <div class="h">INGREDIENTS</div>
      <ul class="checklist">${r.ingredients.map((i) => {
        const a = amountText(i, ctx.factor, sys);
        const on = have.has(i.id);
        return `<li data-have="${esc(i.id)}" class="${on ? 'on' : ''}"><span class="box">${on ? '✓' : ''}</span><span class="txt">
          ${a == null ? '<b class="amt missing">??</b>' : `<b class="amt">${esc(a)}</b>`} ${esc(itemText(i, ctx.factor))}${i.prep ? `<span class="prep">, ${esc(i.prep)}</span>` : ''}
          ${a == null ? `<span class="ingnote">${esc(i.note || 'No amount in the source')}${i.suggest ? ` · <span class="sug">suggested: ${esc(amountText({ ...i, ...i.suggest, missing: false }, ctx.factor, sys))}</span>` : ''}</span>` : ''}
        </span></li>`;
      }).join('')}</ul>
    </div>

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

    <div class="row">
      <button class="btn ghost grow" data-go="#/edit/${esc(r.id)}">✎ EDIT</button>
      <button class="btn ghost grow" id="dup">⧉ MY VERSION</button>
      <button class="btn ghost" id="del" aria-label="Delete">🗑</button>
    </div>
  </main>
  <div class="dock"><div class="inner"><button class="btn block" id="cook">▶ COOK MODE</button></div></div>`;
}

const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

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
function openCook(r) {
  session.cook = { id: r.id, i: 0, finished: false };
  keepAwake(true);
  renderCook();
}
function closeCook() {
  session.cook = null;
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
    el.innerHTML = `<div class="stage win">${logoSvg({ size: 96 })}<div class="xp">QUEST<br>COMPLETE<br>+50 XP</div><p class="muted">${esc(r.title)} · cooked ${r.cooked}×</p></div>
      <button class="btn block" id="cookClose">BACK TO RECIPE</button>`;
    confetti();
  } else {
    const s = r.steps[c.i];
    const k = laneIndex(r).indexOf(s.lane) + 1;
    const pct = Math.round((c.i / r.steps.length) * 100);
    const running = timers.filter((t) => t.recipe === r.id && t.end > Date.now()).map((t) => t.label);
    el.innerHTML = `
      <div class="bar"><button class="icon-btn" id="cookClose" aria-label="Close">✕</button><div class="quest"><i style="width:${pct}%"></i></div><span class="px" style="font-size:10px">${c.i + 1}/${r.steps.length}</span></div>
      <div class="stage">
        <div class="where"><span class="tag lane-${k}">${esc(s.lane)} · ${esc(laneName(r, s.lane))}</span>${s.wait ? '<span class="pill off">hands-off</span>' : ''}
          ${(s.merges || []).map((m) => `<span class="pill">⤵ ${esc(laneName(r, m))} joins</span>`).join('')}</div>
        <div class="bigtext">${renderText(s.text, r, ctx)}</div>
        ${s.timer ? `<button class="btn alt" data-timer="${esc(s.id)}">⏱ START ${esc(s.timer.label.toUpperCase())} · ${minutesText(s.timer.min)}</button>` : ''}
        ${running.length ? `<p class="small muted">Still going: ${running.map(esc).join(', ')}</p>` : ''}
      </div>
      <div class="nav"><button class="btn ghost" id="prev" ${c.i === 0 ? 'disabled' : ''}>◀ BACK</button><button class="btn good" id="next">${c.i === r.steps.length - 1 ? '★ FINISH' : 'DONE ▶'}</button></div>`;
  }
  document.body.append(el);
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'cookClose') return closeCook(), render();
    if (t.id === 'prev') { c.i = Math.max(0, c.i - 1); return renderCook(); }
    if (t.dataset.timer) return startTimer(r, t.dataset.timer);
    if (t.id === 'next') {
      ctx.done.add(r.steps[c.i].id);
      if (c.i < r.steps.length - 1) { c.i++; return renderCook(); }
      r.cooked = (r.cooked || 0) + 1;
      db.xp = (db.xp || 0) + 50;
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
const timers = [];
function startTimer(r, stepId) {
  const s = r.steps.find((x) => x.id === stepId);
  if (!s?.timer) return;
  if (timers.some((t) => t.step === stepId && t.end > Date.now())) return toast('That timer is already running');
  timers.push({ id: Math.random().toString(36).slice(2), recipe: r.id, step: stepId, label: s.timer.label, end: Date.now() + s.timer.min * 60000, rang: false });
  toast(`⏱ ${s.timer.label} · ${minutesText(s.timer.min)} started`);
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
function tick() {
  const box = document.getElementById('timers');
  const now = Date.now();
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].dismissed) timers.splice(i, 1);
  box.innerHTML = timers.map((t) => {
    const left = Math.max(0, t.end - now);
    if (!left && !t.rang) { t.rang = true; beep(); }
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    return `<div class="tchip${left ? '' : ' ring'}">${esc(t.label.toUpperCase())} ${left ? `${m}:${String(s).padStart(2, '0')}` : 'DONE!'}<button data-stop="${t.id}" aria-label="Dismiss">✕</button></div>`;
  }).join('');
  if (timers.some((t) => !t.rang || t.end > now)) setTimeout(tick, 500);
  else if (timers.length) setTimeout(tick, 1500); // keep ringing chips visible
}
document.getElementById('timers').addEventListener('click', (e) => {
  const id = e.target.closest('[data-stop]')?.dataset.stop;
  const t = timers.find((x) => x.id === id);
  if (t) { t.dismissed = true; tick(); }
});

// ---------- import flow ----------
async function runImport(input) {
  const text = input.trim();
  if (!text) return toast('Paste a link or some recipe text first');
  const box = document.getElementById('importing');
  if (box) box.innerHTML = '<div class="loading"><div class="loadbar"><i></i></div><span class="px small">READING…</span></div>';
  try {
    const { recipe, flags } = await importAnything(text);
    session.draft = recipe;
    session.flags = flags;
    session.pendingInput = '';
    session.editing = null;
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
window.addEventListener('hashchange', () => {
  const route = location.hash.split('/')[1] || '';
  if (!['review', 'edit'].includes(route)) session.editing = null;
  const keepScroll = route === lastRoute;
  lastRoute = route;
  const y = window.scrollY;
  render();
  if (keepScroll) window.scrollTo(0, y);
});

function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }

$app.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    session.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = document.getElementById('search');
    s.focus(); s.setSelectionRange(pos, pos);
  }
  if (e.target.dataset.color) {
    db.theme.custom = { ...theme(), [e.target.dataset.color]: e.target.value };
    paint(db.theme.custom);
    save();
  }
});
$app.addEventListener('change', (e) => { if (e.target.dataset.color) rerender(); });

$app.addEventListener('click', (e) => {
  const t = e.target.closest('button, [data-open], [data-have], [data-step], a');
  if (!t) return;
  const d = t.dataset;
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const r = route === 'r' ? byId(arg) : null;

  if ('back' in d) return history.length > 1 ? history.back() : go('#/');
  if (d.go) return go(d.go);
  if (d.open) return go('#/r/' + d.open);

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
    if (t.id === 'saveDraft') {
      syncDraft();
      const rec = finalize(structuredClone(dr));
      rec.ingredients.forEach((i) => { delete i.edited; });
      const idx = db.recipes.findIndex((x) => x.id === rec.id);
      if (idx >= 0) db.recipes[idx] = rec; else { db.recipes.unshift(rec); emit('recipe.saved', { recipeId: rec.id, title: rec.title, platform: rec.source?.platform }); }
      if (!session.editing) emit('recipe.scraped', { recipeId: rec.id, platform: rec.source?.platform });
      save();
      session.draft = null; session.editing = null;
      toast('Saved to your cookbook');
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
    if (t.id === 'dup') {
      const copy = structuredClone(r);
      copy.id = 'r' + Date.now().toString(36);
      copy.title = `${r.title} (my version)`;
      copy.parent = r.id; copy.cooked = 0; delete copy.sample;
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

  // theme screen
  if (d.preset) { db.theme = { preset: d.preset, custom: null }; paint(theme()); save(); return rerender(); }
  if (t.id === 'fixc') { db.theme.custom = fixContrast(theme()); paint(db.theme.custom); save(); return rerender(); }
  if (t.id === 'resetc') { db.theme.custom = null; paint(theme()); save(); return rerender(); }
});

document.addEventListener('keydown', (e) => {
  if (!session.cook) return;
  if (e.key === 'ArrowRight') document.getElementById('next')?.click();
  if (e.key === 'ArrowLeft') document.getElementById('prev')?.click();
  if (e.key === 'Escape') document.getElementById('cookClose')?.click();
});

render();
