// TRACK MAP: bitrecipe's own recipe grid.
//
// Cooking for Engineers draws a wide table: ingredients on the left, steps
// as boxes that span them. Great on paper, cramped on a phone, and it can't
// show *time*. The Track Map is vertical and phone-first:
//   - every vessel/job is a TRACK (Dry bowl, Mixer, Oven) drawn as a pixel
//     rail on the left, each with its own letter AND line pattern (never
//     colour alone);
//   - steps hang off their track in the order you do them;
//   - when two things combine, the rail physically joins the other one;
//   - when two rails run side by side, you can do both at once ("meanwhile");
//   - amounts are written inside each step, scaled and converted live;
//   - hands-off steps (chill, bake) are dashed, with a one-tap named timer.

import { amountText, itemText, minutesText } from './units.js';
import { flame } from './sprites.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// "{flour}" -> "<b>2¼ cups flour</b>"
export function renderText(text, recipe, ctx) {
  return esc(text).replace(/\{([\w-]+)(?:\*([\d.]+))?\}/g, (all, id, part) => {
    const ing = recipe.ingredients.find((i) => i.id === id);
    if (!ing) return '';
    const p = part ? parseFloat(part) : 1;
    const amt = amountText(ing, ctx.factor, ctx.system, p);
    const name = esc(itemText(ing, ctx.factor, p));
    if (ing.loose) return `<b class="amt">${name}</b> <i class="loose">(${esc(ing.loose)})</i>`;
    if (amt == null) return `<b class="amt missing" title="${esc(ing.note || 'Amount missing')}">?? ${name}</b>`;
    return `<b class="amt">${esc(amt)} ${name}</b>`;
  });
}

export function laneIndex(recipe) {
  const order = [];
  for (const s of recipe.steps) if (!order.includes(s.lane)) order.push(s.lane);
  for (const l of recipe.lanes) if (!order.includes(l.id)) order.push(l.id);
  return order;
}

// For each lane: first and last row it is "live" on the rail.
export function laneSpans(recipe) {
  const spans = {};
  recipe.steps.forEach((s, i) => {
    const touch = (id) => {
      spans[id] = spans[id] || { start: i, end: i };
      spans[id].end = i;
    };
    touch(s.lane);
    (s.merges || []).forEach(touch);
  });
  return spans;
}

// Biggest number of tracks running at the same moment.
export function maxParallel(recipe) {
  const spans = laneSpans(recipe);
  let best = 1;
  recipe.steps.forEach((_, i) => {
    const n = Object.values(spans).filter((sp) => sp.start <= i && i < sp.end).length;
    best = Math.max(best, n);
  });
  return best;
}

const COL = 26; // px per track column

export function laneName(recipe, id) {
  return recipe.lanes.find((l) => l.id === id)?.name || `Track ${id}`;
}

export function renderLegend(recipe) {
  const order = laneIndex(recipe);
  return `<div class="legend">${order
    .map((id, k) => `<span class="lg"><i class="sw lane-${k + 1}"></i><b class="tag lane-${k + 1}">${esc(id)}</b>${esc(laneName(recipe, id))}</span>`)
    .join('')}</div>`;
}

export function renderTrackMap(recipe, ctx) {
  const order = laneIndex(recipe);
  const col = Object.fromEntries(order.map((id, k) => [id, k]));
  const spans = laneSpans(recipe);
  const width = order.length * COL + 6;
  const rows = recipe.steps.map((s, i) => {
    let g = '';
    for (const id of order) {
      const sp = spans[id];
      if (!sp) continue;
      const k = col[id];
      const x = k * COL + 10;
      const cls = `lane-${k + 1}`;
      const merging = (s.merges || []).includes(id);
      if (sp.start < i && i <= sp.end) g += `<i class="seg v ${cls}" style="left:${x}px;top:0;height:24px"></i>`;
      if (sp.start <= i && i < sp.end && !merging) g += `<i class="seg v ${cls}" style="left:${x}px;top:24px;bottom:0"></i>`;
      if (merging) {
        const a = Math.min(k, col[s.lane]) * COL + 10, b = Math.max(k, col[s.lane]) * COL + 16;
        g += `<i class="seg h ${cls}" style="left:${a}px;width:${b - a}px;top:21px"></i>`;
      }
    }
    const k = col[s.lane];
    const done = ctx.done?.has(s.id);
    g += `<b class="node lane-${k + 1}${done ? ' done' : ''}" style="left:${k * COL + 4}px">${done ? '✓' : esc(s.lane)}</b>`;
    const prev = recipe.steps[i - 1];
    const others = order.filter((id) => id !== s.lane && spans[id] && spans[id].start < i && i < spans[id].end && !(s.merges || []).includes(id));
    const meanwhile = prev && prev.lane !== s.lane && others.length ? `<span class="pill mw">⇉ while ${esc(others.map((o) => laneName(recipe, o)).join(' + '))}</span>` : '';
    const joins = (s.merges || []).map((m) => `<div class="joins lane-${col[m] + 1}">⤵ <b>${esc(laneName(recipe, m))}</b> joins here</div>`).join('');
    const timer = s.timer ? `<button class="pill timer" data-timer="${esc(s.id)}">⏱ ${esc(s.timer.label)} · ${minutesText(s.timer.min)}</button>` : '';
    const at = s.at ? `<a class="pill at" ${recipe.source?.url ? `href="${esc(recipe.source.url)}" target="_blank" rel="noopener"` : ''} title="Where this happens in the video">▶ ${esc(s.at)}</a>` : '';
    return `<div class="trow${done ? ' done' : ''}">
      <div class="tgraph" style="width:${width}px">${g}</div>
      <div class="tcard${s.wait ? ' wait' : ''}" data-step="${esc(s.id)}">
        <div class="thead"><span class="sn">${String(i + 1).padStart(2, '0')}</span><span class="tag lane-${k + 1}">${esc(laneName(recipe, s.lane))}</span>${s.wait ? `<span class="pill off">${flame(10)} hands-off</span>` : ''}${meanwhile}</div>
        ${joins}
        <p>${renderText(s.text, recipe, ctx)}</p>
        ${timer || at ? `<div class="tfoot">${timer}${at}</div>` : ''}
      </div>
    </div>`;
  });
  return `<div class="trackmap">${rows.join('')}<div class="trow end"><div class="tgraph" style="width:${width}px"><b class="node fin" style="left:${col[recipe.steps.at(-1)?.lane] * COL + 4 || 4}px">★</b></div><div class="tcard fin">Serve it up.</div></div></div>`;
}

export function renderList(recipe, ctx) {
  return `<ol class="plainlist">${recipe.steps
    .map((s, i) => {
      const done = ctx.done?.has(s.id);
      return `<li class="${done ? 'done' : ''}" data-step="${esc(s.id)}"><span class="sn">${i + 1}</span><p>${renderText(s.text, recipe, ctx)}${s.timer ? ` <button class="pill timer" data-timer="${esc(s.id)}">⏱ ${minutesText(s.timer.min)}</button>` : ''}</p></li>`;
    })
    .join('')}</ol>`;
}
