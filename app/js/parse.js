// Import: link or text in, draft recipe + honest flags out.
// Websites: schema.org/Recipe JSON-LD first, then page description.
// TikTok: oEmbed caption. Instagram: page caption (og:description).
// Text: section + quantity heuristics. Nothing missing is ever guessed
// silently; it is flagged for the review screen instead.

import { normUnit, UNIT_WORDS, COUNT_UNITS } from './units.js';

const UNI_FRAC = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅕': '1/5' };
const QTY = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)`;
const unitAlt = UNIT_WORDS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s')).join('|');
const ING_RE = new RegExp(String.raw`^(${QTY}|an?)(?:\s*(?:-|–|to)\s*(${QTY}))?\s*(?:(${unitAlt})\.?(?=[\s,)(]|$))?\s*(?:of\s+)?(.*)$`);
const LOOSE_RE = /\b(to taste|as needed|for (?:garnish|serving|frying|greasing)|optional)\b/i;
const VAGUE_RE = /\b(handful|splash|drizzle|glug|some|bit of|sprinkle|dollop|squeeze|knob)\b/i;

const ING_HEAD = /^(?:ingredients?|you(?:'|’)ll need|what you need|shopping list)\b\s*:?\s*(.*)$/i;
const STEP_HEAD = /^(?:method|instructions?|directions?|steps?|how to(?: make(?: it)?)?|preparation|recipe)\b\s*:?\s*(.*)$/i;
const SUB_HEAD = /^for the ([\w\s]+?):?$/i;

let uid = 0;
const newId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

function toNum(s) {
  if (s == null) return null;
  s = s.trim().replace(',', '.');
  if (/^an?$/i.test(s)) return 1;
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return +mixed[1] + mixed[2] / mixed[3];
  const fr = s.match(/^(\d+)\/(\d+)$/);
  if (fr) return fr[1] / fr[2];
  return parseFloat(s);
}

export function cleanLine(line) {
  let s = line.replace(/[½⅓⅔¼¾⅛⅜⅝⅞⅕]/g, (m) => ' ' + UNI_FRAC[m]).replace(/(\d)\s+(\d\/)/g, '$1 $2');
  // strip bullets, checkboxes and leading emoji
  s = s.replace(/^[\s\-*•·▢◦☐✓✔️>]+/u, '').replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '');
  return s.replace(/\s+/g, ' ').trim();
}

// "2 1/4 cups flour, sifted" -> {qty, qty2, unit, item, prep}
export function parseIngredientLine(raw) {
  const line = cleanLine(raw);
  if (!line) return null;
  const ing = { id: newId('i'), qty: null, unit: '', item: line, prep: '', raw: line };
  const m = line.match(ING_RE);
  let rest = line;
  if (m && !(/^an?$/i.test(m[1]) && !m[3])) {
    ing.qty = toNum(m[1]);
    if (m[2]) ing.qty2 = toNum(m[2]);
    const u = normUnit(m[3] || '');
    ing.unit = u || '';
    rest = m[4] || '';
    if (m[3] && !u) rest = `${m[3]} ${rest}`;
  }
  rest = rest.replace(/^\(([^)]*)\)\s*/, (_, inner) => { ing.note = inner; return ''; });
  const comma = rest.indexOf(',');
  ing.item = (comma > 0 ? rest.slice(0, comma) : rest).trim();
  ing.prep = comma > 0 ? rest.slice(comma + 1).trim() : '';
  const loose = line.match(LOOSE_RE);
  if (loose) {
    ing.item = ing.item.replace(LOOSE_RE, '').replace(/[,\s]+$/, '').trim();
    ing.prep = ing.prep.replace(LOOSE_RE, '').replace(/^[,\s]+|[,\s]+$/g, '');
    if (ing.qty == null) ing.loose = loose[1].toLowerCase();
  }
  if (ing.unit === 'handful' || (ing.qty == null && !ing.loose)) {
    ing.missing = true;
    ing.qty = null;
    ing.unit = '';
    ing.note = VAGUE_RE.test(line) ? `Source said “${line}”` : 'No amount in the source';
    ing.item = ing.item.replace(/^(a|an|some)\s+((big|small|good|large)\s+)?(handful|splash|drizzle|glug|sprinkle|dollop|squeeze|knob|bit)\s+of\s+/i, '');
  }
  if (ing.unit === 'pinch' && ing.qty == null) ing.qty = 1;
  if (!ing.item) ing.item = line;
  return ing;
}

const looksLikeIngredient = (l) => {
  const c = cleanLine(l);
  return c.length < 80 && (new RegExp(`^${QTY}`).test(c) || /^an?\s+(pinch|handful|splash|knob|dash)/i.test(c) || LOOSE_RE.test(c)) && !/[.!?]$/.test(c.replace(/\b(tsp|tbsp|oz|lb)\.$/, ''));
};
const numbered = /^\s*(?:step\s*)?\d+\s*[.):-]\s+/i;

function splitInline(text) {
  // "1. Boil 2. Melt 3. Toss" on one line -> separate steps
  return text
    .replace(/\s*\b(ingredients|method|instructions|directions|steps)\s*:/gi, '\n$1:')
    .replace(/\s+(?=(?:step\s*)?\d{1,2}[.)]\s+[A-Z])/g, '\n');
}

// Text -> {title, ingredients[], steps[], sections[]}
export function parseText(text) {
  const out = { title: '', ingredientLines: [], stepLines: [], servings: null };
  let mode = null;
  let section = null;
  const lines = splitInline(text.replace(/\r/g, '')).split('\n').map((l) => l.trim()).filter(Boolean);
  for (let raw of lines) {
    if (/^(#\w+\s*)+$/.test(raw)) continue; // hashtag-only lines
    raw = raw.replace(/(\s#\w+)+\s*$/, '');
    const l = cleanLine(raw);
    if (!l) continue;
    const serv = l.match(/\b(?:serves|servings|makes|yield)\s*:?\s*(\d+)/i);
    if (serv && l.length < 40) { out.servings = +serv[1]; continue; }
    let m;
    if ((m = l.match(ING_HEAD))) {
      mode = 'ing';
      if (m[1]) m[1].split(/\s*[,;•|]\s*/).map((p) => p.replace(/\.$/, '')).forEach((p) => p && out.ingredientLines.push(p));
      continue;
    }
    if ((m = l.match(STEP_HEAD)) && l.length < 40) {
      mode = 'step';
      if (m[1]) out.stepLines.push({ text: m[1], section });
      continue;
    }
    if ((m = l.match(SUB_HEAD))) { section = m[1].trim(); continue; }
    if (mode === 'ing' && numbered.test(l) && l.length > 50) mode = 'step';
    if (mode === 'ing' || (mode === null && looksLikeIngredient(l))) {
      if (mode === 'ing' && l.length > 90 && !looksLikeIngredient(l)) { mode = 'step'; out.stepLines.push({ text: l.replace(numbered, ''), section }); continue; }
      out.ingredientLines.push(l);
      continue;
    }
    if (mode === 'step' || numbered.test(l) || (out.title && l.split(' ').length > 5)) {
      mode = mode || 'step';
      out.stepLines.push({ text: l.replace(numbered, ''), section });
      continue;
    }
    if (!out.title) out.title = l.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/[!:\s]+$/, '').slice(0, 80);
  }
  return out;
}

// ---------- step analysis: timers, waiting, lanes, equipment ----------

const TIMER_RE = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?))?\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i;
const WAIT_RE = /\b(rest|chill|marinate|refrigerate|freeze|bake|roast|simmer|boil|proof|prove|rise|steep|soak|let (?:it |them )?(?:sit|cool|rest|rise))\b/i;
const NEW_LANE_RE = /\b(?:in (?:a |another )?(?:separate|second|other|clean|small|medium|large)\s+(bowl|pan|pot|skillet|saucepan|jug|tray|dish))|\bmeanwhile\b|\bat the same time\b|\bwhile (?:that|the \w+) (?:cooks|bakes|rests|boils|simmers)\b/i;
const OVEN_RE = /\bpreheat\b/i;
const COMBINE_RE = /\b(combine|add|pour|fold|stir|tip|transfer|toss|mix|scoop|spoon|drain|return)\b/i;
const MIXTURE_RE = /\b(mixture|wet ingredients|dry ingredients|batter|dough|everything)\b/i;
const BAKE_RE = /\b(bake|into the oven|in the oven|roast)\b/i;
const GROUPS = [
  ['pasta', 'spaghetti', 'noodles', 'noodle', 'penne', 'linguine', 'fettuccine', 'macaroni', 'rigatoni', 'ramen', 'udon'],
  ['rice', 'grains'],
  ['chicken', 'meat', 'beef', 'pork', 'steak', 'mince'],
  ['sauce', 'dressing', 'glaze'],
  ['veg', 'vegetables', 'veggies'],
];
const VESSEL_RE = /\b(bowl|pan|pot|skillet|saucepan|jug|tray|dish|oven|blender|wok)\b/i;
const EQUIP = ['mixing bowl', 'bowl', 'pan', 'whisk', 'frying pan', 'skillet', 'saucepan', 'pot', 'baking sheet', 'baking tray', 'tray', 'sheet pan', 'oven', 'blender', 'food processor', 'stand mixer', 'hand mixer', 'mixer', 'air fryer', 'wok', 'grill', 'slow cooker', 'instant pot', 'loaf tin', 'cake tin', 'spatula', 'tongs', 'rolling pin', 'baking dish', 'jug', 'microwave'];

export function timerFrom(text, fallback = 'Timer') {
  const m = text.match(TIMER_RE);
  if (!m) return null;
  let min = parseFloat(m[1].replace(',', '.'));
  if (/^h/i.test(m[3])) min *= 60;
  if (min <= 0 || min > 24 * 60) return null;
  const low = text.toLowerCase();
  const verb = VERBS.find((v) => new RegExp(`\\b${v}`).test(low));
  return { min: Math.round(min), label: verb ? cap(verb) : fallback };
}

function laneName(text, fallback) {
  const v = text.match(VESSEL_RE);
  return v ? v[1][0].toUpperCase() + v[1].slice(1).toLowerCase() : fallback;
}

const VERBS = ['boil', 'melt', 'fry', 'bake', 'simmer', 'rest', 'chill', 'cook', 'roast', 'beat', 'whisk', 'knead', 'toss', 'sear', 'saute', 'sauté', 'marinate', 'steam', 'grill', 'toast', 'blend', 'proof', 'prove', 'rise', 'cool', 'soak', 'reduce', 'caramelise', 'caramelize', 'brown', 'microwave', 'air fry'];

function wordsOf(text, ingredients) {
  const low = text.toLowerCase();
  const words = new Set();
  for (const ing of ingredients) for (const k of keysFor(ing.item)) if (new RegExp(`\\b${k}`).test(low)) words.add(k);
  for (const g of GROUPS) if (g.some((w) => new RegExp(`\\b${w}`).test(low))) words.add('#' + g[0]);
  const v = low.match(VESSEL_RE);
  if (v) words.add(v[1]);
  return words;
}

// Assign lanes ("tracks") + merges to plain step texts. A merge happens when
// a step combines things AND mentions something another open track made.
export function guessLanes(stepTexts, ingredients = []) {
  const lanes = [];
  const active = new Set();
  const laneWords = new Map();
  const steps = [];
  const letters = ['A', 'B', 'C'];
  const sectionLane = new Map();
  const open = (name) => {
    const id = letters.find((l) => !lanes.some((x) => x.id === l)) || letters.find((l) => !active.has(l));
    if (!id) return null;
    const existing = lanes.find((x) => x.id === id);
    if (existing) { if (!existing.name.includes(name)) existing.name = `${existing.name} / ${name}`; }
    else {
      const same = lanes.filter((x) => x.name === name || x.name.startsWith(name + ' ')).length;
      lanes.push({ id, name: same ? `${name} ${same + 1}` : name });
    }
    active.add(id);
    laneWords.set(id, new Set());
    return id;
  };
  const first = stepTexts[0]?.text || '';
  let cur = open(stepTexts[0]?.section ? cap(stepTexts[0].section) : OVEN_RE.test(first) ? 'Oven' : /\bboil/i.test(first) ? 'Pot' : laneName(first, 'Main'));
  stepTexts.forEach(({ text, section }, i) => {
    let lane = cur;
    let next = null;
    const merges = [];
    const words = wordsOf(text, ingredients);
    if (section && i > 0 && !sectionLane.has(section) && active.size < 3) {
      lane = open(cap(section)) || cur;
      sectionLane.set(section, lane);
    } else if (section && sectionLane.has(section)) {
      lane = sectionLane.get(section);
    } else if (i > 0 && OVEN_RE.test(text) && !lanes.some((l) => l.name === 'Oven' && active.has(l.id))) {
      lane = open('Oven') || cur;
      next = cur; // the oven heats in the background; work carries on
    } else if (i > 0 && NEW_LANE_RE.test(text)) {
      lane = open(laneName(text, `Track ${String.fromCharCode(65 + lanes.length)}`)) || cur;
    }
    if (i === 0 && section) sectionLane.set(section, cur);
    // the oven only heats and bakes; other work goes on a real track
    const ovenLane = lanes.find((l) => l.id === lane && l.name === 'Oven');
    if (i > 0 && ovenLane && !OVEN_RE.test(text) && !BAKE_RE.test(text)) {
      lane = [...active].find((id) => id !== ovenLane.id) || open(laneName(text, 'Prep')) || lane;
    }
    if (i > 0 && active.size > 1 && (COMBINE_RE.test(text) || BAKE_RE.test(text))) {
      const oven = lanes.find((l) => l.name === 'Oven' && active.has(l.id));
      if (BAKE_RE.test(text) && oven) { lane = oven.id; next = null; }
      else {
        // "add X to the pan": the pan's track receives it
        const target = text.toLowerCase().match(/\b(?:to|into|in) the (bowl|pan|pot|skillet|saucepan|jug|tray|dish|wok)\b/);
        const owner = target && [...active].find((id) => id !== lane && laneWords.get(id)?.has(target[1]));
        if (owner) { lane = owner; next = null; }
      }
      for (const other of active) {
        if (other === lane) continue;
        if (oven && other === oven.id) continue;
        const theirs = laneWords.get(other) || new Set();
        const overlap = [...words].some((w) => theirs.has(w));
        if (MIXTURE_RE.test(text) || overlap || (BAKE_RE.test(text) && lane === oven?.id)) merges.push(other);
      }
    }
    merges.forEach((m) => { for (const w of laneWords.get(m) || []) laneWords.get(lane)?.add(w); active.delete(m); });
    active.add(lane);
    words.forEach((w) => laneWords.get(lane)?.add(w));
    const ln = lanes.find((l) => l.id === lane);
    const vessel = text.match(VESSEL_RE);
    if (ln && /^(Main|Track [A-C])$/.test(ln.name) && vessel) ln.name = cap(vessel[1].toLowerCase());
    cur = next || lane;
    const timer = timerFrom(text, lanes.find((l) => l.id === lane)?.name);
    steps.push({ id: newId('s'), lane, text, merges, timer, wait: !!(timer && WAIT_RE.test(text)) });
  });
  return { lanes, steps };
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

export function guessEquipment(texts) {
  const all = texts.join(' ').toLowerCase();
  const found = [];
  for (const e of EQUIP) if (new RegExp(`\\b${e}s?\\b`).test(all) && !found.some((f) => f.includes(e))) found.push(e);
  return found.map((e) => e[0].toUpperCase() + e.slice(1));
}

// ---------- linking ingredients into step text ----------

const STOP = new Set(['fresh', 'large', 'small', 'medium', 'of', 'the', 'a', 'chopped', 'minced', 'sliced', 'diced', 'ground', 'whole', 'extra', 'virgin', 'plain', 'all-purpose', 'unsalted', 'salted', 'room', 'temperature', 'cold', 'warm', 'finely', 'roughly', 'and', 'or', 'big', 'good']);

const CUTS = new Set(['breast', 'breasts', 'thigh', 'thighs', 'fillet', 'fillets', 'leaves', 'cloves', 'clove', 'cubes', 'mince', 'stock', 'slices', 'chunks', 'florets', 'wings']);
function keysFor(item) {
  const words = item.toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  const keys = [];
  if (words.length > 1) keys.push(words.join(' '));
  if (words.length) keys.push(words[words.length - 1]);
  if (words.length > 1 && CUTS.has(words[words.length - 1])) keys.push(words[0]);
  return keys.flatMap((k) => [k, k.replace(/(es|s)$/, '')]).filter((k) => k.length > 2);
}

// Replace the first mention of each ingredient with {id} so the step shows
// the (scaled) amount inline, unless the text already states an amount.
export function linkSteps(ingredients, steps) {
  const used = new Set();
  for (const step of steps) for (const m of step.text.matchAll(/\{([\w-]+)(?:\*[\d.]+)?\}/g)) used.add(m[1]);
  for (const step of steps) {
    for (const ing of ingredients) {
      if (used.has(ing.id)) continue;
      for (const key of keysFor(ing.item)) {
        const re = new RegExp(`(^|[^\\w{])(${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(e?s)?\\b`, 'i');
        const m = step.text.match(re);
        if (!m) continue;
        used.add(ing.id);
        const at = m.index + m[1].length;
        const before = step.text.slice(Math.max(0, at - 18), at);
        if (new RegExp(`${QTY}\\s*(?:${unitAlt})?\\.?\\s*(?:of\\s+)?$`, 'i').test(before)) break; // amount already written
        step.text = step.text.slice(0, at) + `{${ing.id}}` + step.text.slice(at + m[2].length + (m[3] || '').length);
        break;
      }
    }
  }
  return steps;
}

// Turn editable "[flour]" markers into tokens; tokens into markers.
export function tokensToMarkers(text, ingredients) {
  return text.replace(/\{([\w-]+)(?:\*([\d.]+))?\}/g, (all, id, part) => {
    const ing = ingredients.find((i) => i.id === id);
    if (!ing) return all;
    return part ? `[${ing.item} ×${part}]` : `[${ing.item}]`;
  });
}
export function markersToTokens(text, ingredients) {
  return text.replace(/\[([^\]×]+?)(?:\s*×\s*([\d.]+))?\]/g, (all, name, part) => {
    const n = name.trim().toLowerCase();
    const ing = ingredients.find((i) => i.item.toLowerCase() === n) || ingredients.find((i) => i.item.toLowerCase().includes(n) || n.includes(i.item.toLowerCase()));
    if (!ing) return name;
    return part ? `{${ing.id}*${part}}` : `{${ing.id}}`;
  });
}

// ---------- assembling a draft ----------

export function buildDraft({ title, ingredientLines, stepLines, servings, source, flags = [], totalTime, activeTime, image }) {
  const ingredients = ingredientLines.map(parseIngredientLine).filter(Boolean);
  const { lanes, steps } = guessLanes(stepLines, ingredients);
  linkSteps(ingredients, steps);
  const fl = [...flags];
  const missing = ingredients.filter((i) => i.missing);
  if (missing.length) fl.push({ level: 'warn', text: `${missing.length} ingredient${missing.length > 1 ? 's have' : ' has'} no amount in the source. Marked ?? below — fill them in or leave them flagged.` });
  if (!ingredients.length) fl.push({ level: 'bad', text: 'No ingredients found. Add them below, or paste the recipe text.' });
  if (!steps.length) fl.push({ level: 'bad', text: 'No steps found. Add them below, or paste the recipe text.' });
  if (!servings) fl.push({ level: 'warn', text: 'Servings not stated. Set to 2 for now — change it if you know.' });
  if (lanes.length > 1) fl.push({ level: 'info', text: `Guessed ${lanes.length} tracks (${lanes.map((l) => l.name).join(', ')}). Check the track on each step.` });
  const timed = steps.reduce((a, s) => a + (s.timer?.min || 0), 0);
  return {
    recipe: {
      id: newId('r'),
      title: title || 'Untitled recipe',
      servings: servings || 2,
      servingsLabel: 'servings',
      time: { active: activeTime || null, total: totalTime || (timed ? timed + steps.length * 3 : null) },
      source: source || { platform: 'text', creator: '', url: '' },
      equipment: guessEquipment(stepLines.map((s) => s.text)),
      lanes: lanes.length ? lanes : [{ id: 'A', name: 'Main' }],
      ingredients,
      steps,
      cooked: 0,
      created: Date.now(),
      image: image || null,
      importDebug: { ingredientLines: ingredientLines.slice(0, 80), stepLines: stepLines.map((x) => x.text).slice(0, 60) },
    },
    flags: fl,
  };
}

// ---------- sources ----------

export function platformOf(url) {
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  return 'web';
}

function isoMinutes(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const v = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return v || null;
}

const decode = (s) => {
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n); if (r) return r; } return null; }
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return findRecipeNode(node['@graph']) || findRecipeNode(node.mainEntity) || null;
}

function instructionsOf(ri) {
  const out = [];
  const walk = (x, section) => {
    if (!x) return;
    if (typeof x === 'string') { decode(x).split(/\n+|(?<=\.)\s+(?=\d+\.\s)/).forEach((t) => t.trim() && out.push({ text: t.replace(numbered, '').trim(), section })); return; }
    if (Array.isArray(x)) { x.forEach((y) => walk(y, section)); return; }
    if (x['@type'] === 'HowToSection' || x.itemListElement) { walk(x.itemListElement, x.name ? decode(x.name).replace(/^for the\s+/i, '').replace(/:$/, '') : section); return; }
    if (x.text || x.name) out.push({ text: decode(x.text || x.name), section });
  };
  walk(ri);
  return out;
}

function imageOf(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return imageOf(img[0]);
  return img.url || img.contentUrl || null;
}

function metaContent(doc, prop) {
  const el = doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
  return el ? el.getAttribute('content') : null;
}

async function getText(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'text/html,application/json' } });
  } catch (e) {
    const native = window.Capacitor?.isNativePlatform?.();
    throw new Error(native ? 'Could not reach that link. Check your connection, or paste the recipe text instead.' : 'The browser preview can’t read other sites (the Android app can). Paste the recipe text instead.');
  }
  if (!res.ok) throw new Error(`That site answered ${res.status}. Paste the recipe text instead.`);
  return res.text();
}

export async function importUrl(url) {
  const platform = platformOf(url);
  const source = { platform, creator: '', url };
  if (platform === 'tiktok' || platform === 'youtube') {
    const endpoint = platform === 'tiktok' ? 'https://www.tiktok.com/oembed?url=' : 'https://www.youtube.com/oembed?format=json&url=';
    const data = JSON.parse(await getText(endpoint + encodeURIComponent(url)));
    source.creator = data.author_name || '';
    const caption = data.title || '';
    const parsed = parseText(caption);
    const flags = [{ level: 'info', text: `Read the ${platform === 'tiktok' ? 'TikTok caption' : 'video title'} only. Spoken steps and on-screen text are not read yet — check against the video.` }];
    if (caption.length < 60) flags.push({ level: 'bad', text: 'The caption is very short, so the recipe is probably only in the video. Paste the steps as text, or check the creator’s link in bio.' });
    return buildDraft({ ...parsed, title: parsed.title || caption.split(/[.!#\n]/)[0].slice(0, 70), source, flags, image: data.thumbnail_url });
  }
  const html = await getText(url);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (platform === 'web') {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let json;
      try { json = JSON.parse(s.textContent); } catch { continue; }
      const r = findRecipeNode(json);
      if (!r) continue;
      const author = Array.isArray(r.author) ? r.author[0] : r.author;
      source.creator = (author && (author.name || author)) || (doc.querySelector('meta[property="og:site_name"]')?.content ?? new URL(url).hostname);
      const yieldRaw = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
      const servings = parseInt(String(yieldRaw || '').match(/\d+/)?.[0] || '', 10) || null;
      return buildDraft({
        title: decode(r.name || ''),
        ingredientLines: (r.recipeIngredient || r.ingredients || []).map(decode),
        stepLines: instructionsOf(r.recipeInstructions),
        servings,
        totalTime: isoMinutes(r.totalTime),
        activeTime: isoMinutes(r.prepTime) && isoMinutes(r.cookTime) ? null : isoMinutes(r.prepTime),
        source,
        image: imageOf(r.image) || metaContent(doc, 'og:image'),
        flags: [{ level: 'good', text: 'Found the recipe card data on this page.' }],
      });
    }
  }
  // Instagram, or a site without structured data: use the page description.
  const desc = metaContent(doc, 'og:description') || metaContent(doc, 'description') || '';
  let caption = decode(desc);
  const quoted = caption.match(/[:：]\s*["“](.*)["”]\s*\.?$/s);
  if (quoted) caption = quoted[1];
  if (platform === 'instagram') {
    const who = caption.match(/-\s*([\w.]+)\s+on\s/) || decode(metaContent(doc, 'og:title') || '').match(/^(.*?)\s+on Instagram/);
    if (who) source.creator = '@' + who[1].replace(/^@/, '');
  } else {
    source.creator = metaContent(doc, 'og:site_name') || new URL(url).hostname;
  }
  const parsed = parseText(caption);
  const flags = [{ level: platform === 'instagram' ? 'info' : 'warn', text: platform === 'instagram' ? 'Read the post caption only. Instagram often hides the full caption from apps — if things are missing, paste it as text.' : 'This page has no recipe card data, so this came from its description. Check it carefully, or paste the text.' }];
  return buildDraft({ ...parsed, title: parsed.title || decode(metaContent(doc, 'og:title') || doc.title || ''), source, flags, image: metaContent(doc, 'og:image') });
}

export function importText(text) {
  const parsed = parseText(text);
  return buildDraft({ ...parsed, source: { platform: 'text', creator: '', url: '' }, flags: [] });
}

export async function importAnything(input) {
  const t = input.trim();
  const url = t.match(/https?:\/\/\S+/)?.[0];
  // A shared TikTok/IG message is often "caption text https://link"; a bare link means fetch it.
  if (url && t.replace(url, '').trim().length < 40) return importUrl(url);
  const draft = importText(url ? t.replace(url, '') : t);
  if (url) draft.recipe.source = { platform: platformOf(url), creator: '', url };
  return draft;
}
