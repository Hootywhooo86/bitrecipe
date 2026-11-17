// Tiny pixel sprites drawn from text maps, coloured by theme tokens.
// Multi-frame sprites stack frames in one SVG; CSS flips between them.

const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
const PAL = {
  W: 'var(--ink,#f4f1ff)', K: 'var(--bg,#0b0b16)', R: 'var(--accent,#ff5d5d)', D: 'var(--accent-deep,#b91c1c)',
  Y: 'var(--accent2,#facc15)', A: 'var(--lane1,#38bdf8)', P: 'var(--lane3,#f472b6)', G: 'var(--good,#22c55e)',
  S: '#f2c6a0', s: '#d39a74', B: '#7a4b2a', L: '#ffffff', H: 'var(--hi,#ffb3b3)',
  M: mix('var(--ink,#f4f1ff)', 65, 'var(--bg,#0b0b16)'), E: mix('var(--accent-deep,#b91c1c)', 60, 'black'),
  O: mix('var(--bg,#0b0b16)', 55, 'black'), y: mix('var(--accent2,#facc15)', 50, 'white'), a: mix('var(--lane1,#38bdf8)', 70, 'black'),
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

// 128-bit style sprites: outlined, shaded, about twice the detail of 8-bit art.

// Chef running with a frying pan (2 frames: legs swap, pan bobs).
const CHEF = [
  [
    '......OOOOOO........',
    '.....OLWWWWLO.......',
    '....OLWWWWWWWO......',
    '....OWWWWWWWMO......',
    '.....OWWWWWMO.......',
    '.....OMMMMMMO.......',
    '.....OSSSSSsO.......',
    '.....OSKSSKsO.......',
    '.....OSSSSSsO..OOOOO',
    '......OSRRsO..OMMMMO',
    '....OOOSSSsOO.OKKKKO',
    '...OLWWWWWWWMOOOOOO.',
    '...OWWWWWWWWMSSO....',
    '...OSWWWWWWWMOO.....',
    '...OSWWWWWWWMO......',
    '....OWWWWWWMO.......',
    '....OAAAAAAaO.......',
    '....OAAO.OAaO.......',
    '...OAAO...OAaO......',
    '...OKKO...OKKO......',
    '..OKKKO...OKKKO.....',
  ],
  [
    '......OOOOOO........',
    '.....OLWWWWLO.......',
    '....OLWWWWWWWO......',
    '....OWWWWWWWMO......',
    '.....OWWWWWMO..OOOOO',
    '.....OMMMMMMO.OMMMMO',
    '.....OSSSSSsO.OKKKKO',
    '.....OSKSSKsO.OOOOOO',
    '.....OSSSSSsO.OSO...',
    '......OSRRsO.OSO....',
    '....OOOSSSsOOSO.....',
    '...OLWWWWWWWMSO.....',
    '...OWWWWWWWWMO......',
    '...OSWWWWWWWMO......',
    '...OSWWWWWWWMO......',
    '....OWWWWWWMO.......',
    '....OAAAAAAaO.......',
    '.....OAAOAaO........',
    '.....OAAOAaO........',
    '.....OKKOKKO........',
    '....OKKKOKKKO.......',
  ],
];

// Flame (2 frames) for hands-off cooking steps.
const FLAME = [
  [
    '....y.....',
    '....yy....',
    '...yYy....',
    '...YYy.y..',
    '..yYRYyy..',
    '..YRRRYy..',
    '.yYRHRRY..',
    '.YRRHHRY..',
    '.YRHLHRY..',
    '..YRHRY...',
    '...DDDD...',
    '..EEEEEE..',
  ],
  [
    '.....y....',
    '....yy....',
    '....yYy...',
    '..y.yYY...',
    '..yyYRYy..',
    '..yYRRRY..',
    '..YRRHRYy.',
    '..YRHHRRY.',
    '..YRHLHRY.',
    '...YRHRY..',
    '...DDDD...',
    '..EEEEEE..',
  ],
];

// Trophy for badges.
const TROPHY = [[
  '..OOOOOOOOOO..',
  '.OyyYYYYYYDDO.',
  'OYOyYYYYYYDOYO',
  'OYOyYYYYYYDOYO',
  '.OOyYYYYYYDOO.',
  '...OyYYYYDO...',
  '....OYYYDO....',
  '.....OYDO.....',
  '.....OYDO.....',
  '....OOYDOO....',
  '...OEEEEEEO...',
  '..OEDDDDDDEO..',
  '..OOOOOOOOOO..',
]];

export const chef = (size = 40) => sprite(CHEF, { size, cls: 'chef' });
export const flame = (size = 12) => sprite(FLAME, { size, cls: 'flame' });
export const trophy = (size = 24) => sprite(TROPHY, { size, cls: 'trophy' });
