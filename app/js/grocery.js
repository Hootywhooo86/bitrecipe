// Grocery list: pick recipes, their ingredients (minus what you already
// have) merge into one list grouped by aisle. "2 eggs + 3 eggs" = 5 eggs;
// 1 cup flour + 200 g flour = one flour line in grams (per-ingredient density).

import { amountText, densityFor, itemText } from './units.js';

const MASS = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
const VOL = { ml: 1, l: 1000, tsp: 4.929, tbsp: 14.787, cup: 236.6, 'fl oz': 29.57 };

const AISLES = [
  ['Fruit & veg', /\b(onion|garlic|shallot|tomato|potato|carrot|celery|pepper(?!corn)|chili|chilli|lettuce|spinach|kale|cabbage|broccoli|cauliflower|zucchini|courgette|cucumber|mushroom|lemon|lime|orange|apple|banana|berr|avocado|ginger|herb|basil|parsley|cilantro|coriander|mint|thyme|rosemary|scallion|spring onion|leek|corn|peas|beans? sprout|squash|pumpkin|eggplant|aubergine)\b/i],
  ['Meat & fish', /\b(chicken|beef|pork|lamb|turkey|bacon|sausage|mince|steak|ham|salmon|tuna|cod|prawn|shrimp|fish|chorizo)\b/i],
  ['Dairy & eggs', /\b(milk|butter|cream|cheese|parmesan|mozzarella|cheddar|yogurt|yoghurt|egg|eggs|feta|ricotta)\b/i],
  ['Bakery', /\b(bread|bun|tortilla|wrap|pita|baguette|roll)\b/i],
  ['Spices & seasonings', /\b(salt|pepper|paprika|cumin|cinnamon|oregano|chili flakes|chilli flakes|nutmeg|turmeric|curry|spice|seasoning|vanilla|bay lea)\b/i],
  ['Pantry', /\b(flour|sugar|rice|pasta|spaghetti|noodle|oil|vinegar|sauce|stock|broth|baking|yeast|oats|honey|syrup|chocolate|cocoa|beans|lentil|chickpea|can|tin|jar|nuts?|seeds?|soy|ketchup|mustard|mayo)\b/i],
];

export function aisleOf(item) {
  for (const [name, re] of AISLES) if (re.test(item)) return name;
  return 'Other';
}

const SKIP = /\b(all-purpose|all purpose|plain|unsalted|salted|extra virgin|fresh|large|small|medium|chopped|minced|sliced|diced|grated|softened|melted|packed|room temperature|finely|roughly|to taste)\b/gi;
export function keyOf(item) {
  return item.toLowerCase().replace(SKIP, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/(oes|ies|s)$/, (m) => (m === 'ies' ? 'y' : m === 'oes' ? 'o' : ''));
}

// entries: [{ rid, servings, skip: [ingredientId] }]
export function buildList(recipes, entries, manual = [], system = 'orig') {
  const groups = new Map();
  for (const e of entries) {
    const r = recipes.find((x) => x.id === e.rid);
    if (!r) continue;
    const factor = (e.servings || r.servings) / r.servings;
    for (const ing of r.ingredients) {
      if (e.skip?.includes(ing.id)) continue;
      const key = keyOf(ing.item) || ing.item.toLowerCase();
      const g = groups.get(key) || { key, item: ing.item, mass: 0, vol: 0, counts: {}, loose: false, missing: false, from: new Set(), units: new Set(), dens: densityFor(ing.item) };
      g.from.add(r.title);
      if (ing.loose) g.loose = true;
      else if (ing.qty == null) g.missing = true;
      else {
        const q = (ing.qty2 ?? ing.qty) * factor; // buy for the top of a range
        g.units.add(ing.unit);
        if (MASS[ing.unit]) g.mass += q * MASS[ing.unit];
        else if (VOL[ing.unit]) {
          if (g.dens) g.mass += ((q * VOL[ing.unit]) / 236.6) * g.dens; // cups of flour -> grams
          else g.vol += q * VOL[ing.unit];
        } else g.counts[ing.unit || ''] = (g.counts[ing.unit || ''] || 0) + q;
      }
      groups.set(key, g);
    }
  }
  const lines = [...groups.values()].map((g) => {
    const parts = [];
    const sameUnit = g.units.size === 1 ? [...g.units][0] : null;
    const asWritten = system === 'orig' && sameUnit && (MASS[sameUnit] || VOL[sameUnit]);
    if (g.mass) {
      if (asWritten) parts.push(amountText({ qty: g.mass / (MASS[sameUnit] || ((VOL[sameUnit] / 236.6) * g.dens)), unit: sameUnit, item: g.item }, 1, 'orig'));
      else parts.push(amountText({ qty: g.mass, unit: 'g', item: g.item }, 1, system === 'us' ? 'us' : 'metric'));
    }
    if (g.vol) {
      if (asWritten) parts.push(amountText({ qty: g.vol / VOL[sameUnit], unit: sameUnit, item: g.item }, 1, 'orig'));
      else if (system !== 'us' && g.vol < 45) parts.push(amountText(g.vol >= 14.7 ? { qty: Math.round((g.vol / 14.787) * 2) / 2, unit: 'tbsp' } : { qty: g.vol / 4.929, unit: 'tsp' }, 1, 'orig'));
      else parts.push(amountText({ qty: g.vol, unit: 'ml', item: g.item }, 1, system === 'us' ? 'us' : 'metric'));
    }
    for (const [unit, q] of Object.entries(g.counts)) parts.push(amountText({ qty: Math.ceil(q * 4) / 4, unit, item: g.item }, 1, 'orig'));
    if (!parts.length && g.missing) parts.push('?? amount');
    if (!parts.length && g.loose) parts.push('some');
    const name = g.counts[''] ? itemText({ item: g.item, unit: '', qty: g.counts[''] }) : g.item;
    return { key: g.key, item: name, amount: parts.join(' + '), missing: g.missing && parts.length === 1 && parts[0].startsWith('??'), from: [...g.from], aisle: aisleOf(g.item) };
  });
  for (const m of manual) lines.push({ key: 'm:' + m.id, item: m.text, amount: '', from: ['added by you'], aisle: aisleOf(m.text), manual: m.id });
  const order = [...AISLES.map((a) => a[0]), 'Other'];
  return order.map((aisle) => ({ aisle, lines: lines.filter((l) => l.aisle === aisle).sort((a, b) => a.item.localeCompare(b.item)) })).filter((s) => s.lines.length);
}

export function listAsText(sections, checked) {
  return sections.map((s) => `${s.aisle.toUpperCase()}\n` + s.lines.map((l) => `${checked[l.key] ? '☑' : '☐'} ${l.amount ? l.amount + ' ' : ''}${l.item}`).join('\n')).join('\n\n') + '\n\n— made with bitrecipe';
}
