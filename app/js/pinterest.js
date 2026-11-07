// Pinterest board sync: follow a PUBLIC board, and every new pin that links
// to a recipe page lands in the cookbook automatically.
//
// No Pinterest login or server needed: public boards publish an RSS feed
// (pinterest.com/<user>/<board>.rss), and each pin page names the site it
// links to. We then import that site like any shared link (schema.org recipe
// data). Runs inside the Android app; browsers block cross-site reads.

import { importUrl } from './parse.js';

const PIN_HOSTS = /(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/i;

async function fetchText(url) {
  const res = await fetch(url, { headers: { Accept: 'text/html,application/rss+xml,application/xml' } });
  if (!res.ok) throw new Error(`Pinterest answered ${res.status}`);
  return { text: await res.text(), url: res.url || url };
}

// Accepts a board link, a short pin.it link, or user/board.
export async function resolveBoard(input) {
  let raw = input.trim();
  if (!/^https?:/i.test(raw)) raw = 'https://www.pinterest.com/' + raw.replace(/^\/+/, '');
  let url = new URL(raw);
  if (/pin\.it$/i.test(url.hostname)) url = new URL((await fetchText(url.href)).url); // follow the short link
  if (!PIN_HOSTS.test(url.hostname)) throw new Error('That isn’t a Pinterest link');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] === 'pin') throw new Error('Use a board link, like pinterest.com/yourname/dinners');
  const [user, board] = parts;
  const feed = `https://www.pinterest.com/${user}/${board.replace(/\.rss$/, '')}.rss`;
  const { text } = await fetchText(feed);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (!doc.querySelector('channel')) throw new Error('Couldn’t read that board. Is it public?');
  return { url: `https://www.pinterest.com/${user}/${board}/`, feed, name: doc.querySelector('channel > title')?.textContent?.trim() || board, seen: [], last: 0, added: 0 };
}

function pinsFromFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('item')].map((it) => {
    const link = it.querySelector('link')?.textContent?.trim() || '';
    const id = link.match(/\/pin\/(\d+)/)?.[1];
    return id ? { id, link, title: it.querySelector('title')?.textContent?.trim() || '' } : null;
  }).filter(Boolean);
}

// The site a pin points at: og:see_also, else the first non-Pinterest "link".
export function outboundLink(html) {
  const meta = html.match(/<meta[^>]+(?:property|name)="og:see_also"[^>]+content="([^"]+)"/i) || html.match(/content="([^"]+)"[^>]+(?:property|name)="og:see_also"/i);
  if (meta && /^https?:/.test(meta[1])) return meta[1];
  for (const m of html.matchAll(/"link":"(https?:[^"]+)"/g)) {
    const u = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    try { if (!PIN_HOSTS.test(new URL(u).hostname)) return u.replace(/[?&]utm_[^&]+/g, '').replace(/\?$/, ''); } catch { /* bad url */ }
  }
  return null;
}

// Check every board; returns {added, skipped}. `firstRun` boards only take
// their newest few pins so following a big board doesn't flood the cookbook.
export async function syncBoards(boards, { saveRecipe, isKnownUrl, maxPerBoard = 8, onProgress } = {}) {
  let added = 0, skipped = 0;
  for (const b of boards) {
    let pins;
    try { pins = pinsFromFeed((await fetchText(b.feed)).text); } catch { b.error = 'Couldn’t reach this board'; continue; }
    b.error = null;
    const fresh = pins.filter((p) => !b.seen.includes(p.id));
    const take = b.last ? fresh.slice(0, maxPerBoard) : fresh.slice(0, 5);
    if (!b.last) b.seen.push(...fresh.slice(5).map((p) => p.id));
    for (const pin of take) {
      b.seen.push(pin.id);
      onProgress?.(`Reading “${pin.title.slice(0, 40)}”…`);
      try {
        const out = outboundLink((await fetchText(pin.link)).text);
        if (!out || isKnownUrl?.(out)) { skipped++; continue; }
        const { recipe, flags } = await importUrl(out);
        if (!recipe.ingredients.length || !recipe.steps.length) { skipped++; continue; }
        recipe.source = { ...recipe.source, via: 'pinterest', board: b.name, pin: pin.link };
        recipe.needsReview = true;
        recipe.reviewFlags = flags;
        saveRecipe(recipe);
        added++; b.added = (b.added || 0) + 1;
      } catch { skipped++; }
    }
    b.seen = b.seen.slice(-500);
    b.last = Date.now();
  }
  return { added, skipped };
}
