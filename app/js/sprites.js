// Tiny pixel sprites drawn from text maps, coloured by theme tokens.
// Multi-frame sprites stack frames in one SVG; CSS flips between them.

const PAL = {
  W: 'var(--ink,#f4f1ff)', K: 'var(--bg,#0b0b16)', R: 'var(--accent,#ff5d5d)', D: 'var(--accent-deep,#b91c1c)',
  Y: 'var(--accent2,#facc15)', A: 'var(--lane1,#38bdf8)', P: 'var(--lane3,#f472b6)', G: 'var(--good,#22c55e)',
  S: '#f2c6a0', B: '#7a4b2a', O: '#fb923c',
};

function rects(rows) {
  let out = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') out += `<rect x="${x}" y="${y}" width="1.02" height="1.02" style="fill:${PAL[c]}"/>`;
  }));
  return out;
}

export function sprite(frames, { size = 32, cls = '' } = {}) {
  const w = frames[0][0].length, h = frames[0].length;
  const g = frames.map((f, i) => `<g class="f f${i}">${rects(f)}</g>`).join('');
  return `<svg class="sprite ${cls}" viewBox="0 0 ${w} ${h}" width="${size}" height="${Math.round((size * h) / w)}" shape-rendering="crispEdges" aria-hidden="true">${g}</svg>`;
}

// Chef running with a frying pan (2 frames: legs swap, pan bobs).
const CHEF = [
  [
    '...WWWW.....',
    '..WWWWWW....',
    '..WWWWWW....',
    '...SSSS.....',
    '...SKSK.....',
    '...SSSS..KKK',
    '..WWWWWWSKKK',
    '.SWWWWWW....',
    '..WWWWWW....',
    '..AA..AA....',
    '..AA...AA...',
    '.KK.....KK..',
  ],
  [
    '...WWWW.....',
    '..WWWWWW....',
    '..WWWWWW....',
    '...SSSS..KKK',
    '...SKSK..KKK',
    '...SSSS.S...',
    '..WWWWWWS...',
    '.SWWWWWW....',
    '..WWWWWW....',
    '...AAAA.....',
    '...AA.AA....',
    '...KK.KK....',
  ],
];

// Flame (2 frames) for hands-off cooking steps.
const FLAME = [
  ['..Y...', '..YY..', '.YOY..', '.YOOY.', 'YORROY', 'YORROY', '.YRRY.', '..DD..'],
  ['...Y..', '..YY..', '..YOY.', '.YOOY.', 'YOROOY', 'YORROY', '.YRRY.', '..DD..'],
];

// Trophy for badges.
const TROPHY = [[
  'YYYYYYYY',
  'Y.YYYY.Y',
  'Y.YYYY.Y',
  '.YYYYYY.',
  '..YYYY..',
  '...YY...',
  '..DDDD..',
  '.DDDDDD.',
]];

export const chef = (size = 40) => sprite(CHEF, { size, cls: 'chef' });
export const flame = (size = 12) => sprite(FLAME, { size, cls: 'flame' });
export const trophy = (size = 24) => sprite(TROPHY, { size, cls: 'trophy' });
