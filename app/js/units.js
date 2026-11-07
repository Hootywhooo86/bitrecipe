// Units, scaling and conversion. Conversions between cups and grams use a
// per-ingredient density (a cup of flour is not a cup of sugar), never one
// blanket number. Without a known density, volume stays volume.

const UNIT_DEFS = {
  g: { kind: 'mass', base: 1 },
  kg: { kind: 'mass', base: 1000 },
  oz: { kind: 'mass', base: 28.3495 },
  lb: { kind: 'mass', base: 453.592 },
  ml: { kind: 'vol', base: 1 },
  l: { kind: 'vol', base: 1000 },
  tsp: { kind: 'vol', base: 4.929 },
  tbsp: { kind: 'vol', base: 14.787 },
  cup: { kind: 'vol', base: 236.6 },
  'fl oz': { kind: 'vol', base: 29.57 },
};

const ALIASES = {
  g: ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  ml: ['ml', 'mls', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 't'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons', 'T'],
  cup: ['cup', 'cups', 'c'],
  'fl oz': ['fl oz', 'fl. oz', 'fluid ounce', 'fluid ounces'],
};

// Units we keep as-is (counts and small vague-but-real measures).
export const COUNT_UNITS = ['clove', 'can', 'tin', 'pinch', 'dash', 'slice', 'stick', 'sprig', 'bunch', 'head', 'handful', 'piece', 'packet', 'pack', 'jar', 'knob', 'sheet', 'fillet', 'stalk', 'leaf', 'leaves'];

const LOOKUP = new Map();
for (const [unit, names] of Object.entries(ALIASES)) for (const n of names) LOOKUP.set(n, unit);

export function normUnit(raw) {
  if (!raw) return '';
  const r = raw.trim().replace(/\.$/, '');
  if (LOOKUP.has(r)) return LOOKUP.get(r); // case-sensitive first: T vs t
  const low = r.toLowerCase();
  if (LOOKUP.has(low) && low !== 't') return LOOKUP.get(low);
  const single = low.replace(/(es|s)$/, '');
  for (const c of COUNT_UNITS) if (low === c || single === c || low === c + 's' || low === c + 'es') return c;
  return null;
}

export const UNIT_WORDS = [
  ...Object.values(ALIASES).flat(),
  ...COUNT_UNITS.flatMap((c) => [c, c + 's', c + 'es']),
].sort((a, b) => b.length - a.length);

// grams per US cup, matched against the ingredient name (longest first).
const DENSITY = [
  ['powdered sugar', 120], ['icing sugar', 120], ['brown sugar', 213], ['chocolate chips', 170],
  ['cocoa', 85], ['flour', 120], ['sugar', 200], ['butter', 227], ['milk', 240], ['water', 240],
  ['cream', 240], ['yogurt', 245], ['yoghurt', 245], ['oil', 218], ['honey', 340], ['oats', 90],
  ['rice', 185], ['parmesan', 90], ['cheese', 113], ['stock', 240], ['broth', 240],
];

export function densityFor(item = '') {
  const s = item.toLowerCase();
  for (const [k, d] of DENSITY) if (s.includes(k)) return d;
  return null;
}

const FRACTIONS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];

export function fraction(q) {
  let whole = Math.floor(q);
  const rest = q - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - rest) < Math.abs(best[0] - rest)) best = f;
  if (best[0] === 1) { whole += 1; best = FRACTIONS[0]; }
  if (whole === 0 && !best[1]) return '⅛';
  return `${whole || ''}${best[1]}` || '0';
}

function metricNum(q) {
  if (q >= 100) return String(Math.round(q / 5) * 5);
  if (q >= 10) return String(Math.round(q));
  return String(Math.round(q * 2) / 2).replace(/\.0$/, '');
}

function decimalNum(q) {
  return String(Math.round(q * 100) / 100);
}

function usVolume(ml) {
  if (ml >= 59) return { q: ml / 236.6, unit: 'cup' };
  if (ml >= 14) return { q: Math.round((ml / 14.787) * 2) / 2, unit: 'tbsp' };
  return { q: ml / 4.929, unit: 'tsp' };
}

function metricVolume(ml) {
  return ml >= 1000 ? { q: ml / 1000, unit: 'l', metric: true } : { q: ml, unit: 'ml', metric: true };
}

// Convert one amount. system: 'orig' | 'metric' | 'us'.
export function convert(q, unit, item, system) {
  const def = UNIT_DEFS[unit];
  if (!def || system === 'orig') return { q, unit, metric: unit === 'g' || unit === 'ml' || unit === 'kg' || unit === 'l' };
  const dens = densityFor(item);
  const amount = q * def.base; // grams or ml
  if (system === 'metric') {
    if (def.kind === 'mass') return amount >= 1000 ? { q: amount / 1000, unit: 'kg', metric: true } : { q: amount, unit: 'g', metric: true };
    if ((unit === 'tsp' || unit === 'tbsp') && (amount < 30 || (!dens && amount < 60))) return { q, unit };
    if (dens) { const grams = (amount / 236.6) * dens; return { q: grams, unit: 'g', metric: true }; }
    return metricVolume(amount);
  }
  // US
  if (def.kind === 'vol') return usVolume(amount);
  if (dens) return usVolume((amount / dens) * 236.6);
  const oz = amount / 28.3495;
  return oz >= 16 ? { q: Math.round((oz / 16) * 4) / 4, unit: 'lb' } : { q: Math.max(0.5, Math.round(oz * 2) / 2), unit: 'oz' };
}

export function fmtQty(q, metric) {
  if (metric) return metricNum(q);
  if (Number.isInteger(Math.round(q * 1000) / 1000)) return String(Math.round(q));
  return fraction(q);
}

function plural(word, q) {
  if (!word || q <= 1) return word;
  if (word === 'leaf') return 'leaves';
  if (/(s|sh|ch|x)$/.test(word)) return /s$/.test(word) ? word : word + 'es';
  return word + 's';
}

const SHORT = { cup: 'cup', tsp: 'tsp', tbsp: 'tbsp', g: 'g', kg: 'kg', ml: 'ml', l: 'l', oz: 'oz', lb: 'lb', 'fl oz': 'fl oz' };

// Amount text only ("200 g", "1½ cups", "2–3 cloves") or null if missing.
export function amountText(ing, factor = 1, system = 'orig', part = 1) {
  if (ing.loose) return ing.loose;
  if (ing.qty == null) return null;
  const f = factor * part;
  const a = convert(ing.qty * f, ing.unit, ing.item, system);
  let txt = fmtQty(a.q, a.metric);
  if (ing.qty2 != null && ing.qty) txt += '–' + fmtQty(a.q * (ing.qty2 / ing.qty), a.metric);
  const u = a.unit;
  if (!u) return txt;
  const label = SHORT[u] ? (u === 'cup' ? plural('cup', a.q) : SHORT[u]) : plural(u, a.q);
  return `${txt} ${label}`;
}

export function itemText(ing, factor = 1, part = 1) {
  if (ing.unit || ing.qty == null) return ing.item;
  return plural(ing.item, ing.qty * factor * part);
}

export function minutesText(min) {
  if (!min) return '';
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
