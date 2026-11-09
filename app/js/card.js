// Recipe card image to send to friends who don't have the app: photo, title,
// ingredients with amounts, numbered steps, in the current theme colours.

import { amountText, itemText } from './units.js';
import { logoSvg } from './logo.js';

const W = 1080, PAD = 64;

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

// "{flour}" -> "2 cups flour" as plain text
export function plainStep(text, recipe, ctx) {
  return text.replace(/\{([\w-]+)(?:\*([\d.]+))?\}/g, (all, id, part) => {
    const ing = recipe.ingredients.find((i) => i.id === id);
    if (!ing) return '';
    const p = part ? parseFloat(part) : 1;
    const amt = amountText(ing, ctx.factor, ctx.system, p);
    const name = itemText(ing, ctx.factor, p);
    return amt && !ing.loose ? `${amt} ${name}` : name;
  });
}

function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function recipeCard(recipe, ctx) {
  try { await document.fonts.load('28px Pixel'); } catch { /* falls back */ }
  const C = { bg: css('--bg', '#0b0b16'), panel: css('--panel', '#141428'), edge: css('--edge', '#2a2a4a'), ink: css('--ink', '#f4f1ff'), muted: css('--muted', '#9a97b8'), accent: css('--accent', '#ff5d5d'), accent2: css('--accent2', '#facc15') };
  const sans = 'system-ui, -apple-system, Roboto, sans-serif';
  const photo = recipe.photo ? await loadImg(recipe.photo) : null;
  const logo = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg({ size: 96, themed: false })));

  // measure first, draw second
  const m = document.createElement('canvas').getContext('2d');
  const inner = W - PAD * 2;
  m.font = `800 56px ${sans}`;
  const titleLines = wrap(m, recipe.title, inner);
  m.font = `34px ${sans}`;
  const ings = recipe.ingredients.map((i) => {
    const a = amountText(i, ctx.factor, ctx.system);
    return { amt: a == null ? '??' : a, name: itemText(i, ctx.factor) + (i.prep ? `, ${i.prep}` : '') };
  });
  const ingLines = ings.map((i) => wrap(m, `${i.amt} ${i.name}`, inner - 40));
  const steps = recipe.steps.map((s) => wrap(m, plainStep(s.text, recipe, ctx), inner - 80));
  const photoH = photo ? Math.round(W * 0.62) : 0;
  let H = photoH + PAD + titleLines.length * 66 + 70 + 70 + ingLines.reduce((a, l) => a + l.length * 46 + 10, 0) + 60 + 70
    + steps.reduce((a, l) => a + l.length * 46 + 24, 0) + 150;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  if (photo) {
    const s = Math.max(W / photo.width, photoH / photo.height);
    const sw = W / s, sh = photoH / s;
    g.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, 0, 0, W, photoH);
    g.fillStyle = C.accent; g.fillRect(0, photoH, W, 8);
  }
  let y = photoH + PAD + 50;
  g.fillStyle = C.ink; g.font = `800 56px ${sans}`;
  for (const l of titleLines) { g.fillText(l, PAD, y); y += 66; }
  g.fillStyle = C.muted; g.font = `30px ${sans}`;
  const meta = [`Serves ${ctx.servings}`, recipe.time?.total ? `${recipe.time.total} min` : '', recipe.source?.creator ? `by ${recipe.source.creator}` : ''].filter(Boolean).join('  ·  ');
  g.fillText(meta, PAD, y + 4); y += 80;

  const heading = (t) => { g.fillStyle = C.accent; g.font = `26px Pixel, monospace`; g.fillText(t, PAD, y); y += 56; };
  heading('INGREDIENTS');
  g.font = `34px ${sans}`;
  ingLines.forEach((lines, k) => {
    g.fillStyle = C.accent2; g.fillRect(PAD, y - 22, 14, 14);
    lines.forEach((l, j) => {
      if (j === 0) {
        const amt = ings[k].amt;
        g.fillStyle = C.accent2; g.font = `700 34px ${sans}`;
        const aw = l.startsWith(amt) ? g.measureText(amt).width : 0;
        if (aw) g.fillText(amt, PAD + 40, y);
        g.fillStyle = C.ink; g.font = `34px ${sans}`;
        g.fillText(aw ? l.slice(amt.length) : l, PAD + 40 + aw, y);
      } else { g.fillStyle = C.ink; g.fillText(l, PAD + 40, y); }
      y += 46;
    });
    y += 10;
  });
  y += 40;
  heading('METHOD');
  steps.forEach((lines, k) => {
    g.fillStyle = C.accent2; g.font = `24px Pixel, monospace`;
    g.fillText(String(k + 1).padStart(2, '0'), PAD, y);
    g.fillStyle = C.ink; g.font = `34px ${sans}`;
    lines.forEach((l) => { g.fillText(l, PAD + 80, y); y += 46; });
    y += 24;
  });
  // footer
  y = H - 110;
  g.fillStyle = C.edge; g.fillRect(PAD, y, inner, 4);
  if (logo) g.drawImage(logo, PAD, y + 22, 64, 64);
  g.fillStyle = C.ink; g.font = `24px Pixel, monospace`;
  g.fillText('bitrecipe', PAD + 84, y + 66);
  g.fillStyle = C.muted; g.font = `26px ${sans}`;
  const tail = 'made with bitrecipe';
  g.fillText(tail, W - PAD - g.measureText(tail).width, y + 64);
  return c.toDataURL('image/png');
}
