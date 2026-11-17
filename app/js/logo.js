// bitrecipe logo (32×32, shaded 128-bit style): a pixel pot whose two steam "lanes" merge into one bit.
// It is the Rail view in miniature: two tracks of work joining into one dish.
// Pure module (no DOM) so the icon script in /scripts can import it too.

export const LOGO_PIXELS = [
  '..............yyyy..............',
  '..............yYYY..............',
  '..............yYYY..............',
  '..............AabB..............',
  '..............AabB..............',
  '..............AabB..............',
  '............Aa....bB............',
  '...........Aa......bB...........',
  '..........Aa........bB..........',
  '...........Aa......bB...........',
  '...........Aa......bB...........',
  '...........Aa......bB...........',
  '.........Aa..........bB.........',
  '....OOOOOOOOOOOOOOOOOOOOOOOO....',
  '...OWWWWWWWWWWWWWWWWWWWWMMMMO...',
  '...OWWWWWWWWWWWWWWWWWWMMMMMMO...',
  '...OMMMMMMMMMMMMMMMMMMMMMMMMO...',
  '.OOOOOEEEEEEEEEEEEEEEEEEEEOOOOO.',
  'ODDDDDHHHRRRRRRRRRRRRRDDDDDDDDDO',
  'ODEEEDHLHRRRRRRRRRRRRRDDDDDEEEDO',
  'ODDDDDHLHRRRRRRRRRRRRRDDDDDDDDDO',
  '.OOOOOHLHRRRRRRRRRRRRRDDDDOOOOO.',
  '.....OHHHRRRRRRRRRRRRRDDDDO.....',
  '.....OHDDDDDDDDDDDDDDEEEEDO.....',
  '.....OHHHRRRRRRRRRRRRRDDDDO.....',
  '.....ODDDDDDDDDDDDDDEEEEEEO.....',
  '.....ODDDDDDDDDDDDDDEEEEEEO.....',
  '......OODDDDDDDDDDEEEEEEOO......',
  '........OODDDDDDEEEEEEOO........',
  '..........OOOOOOOOOOOO..........',
  '................................',
  '................................',
];

// Each pixel letter: [themed CSS colour, default "Tomato" colour for PNG icons].
// Shades are mixed from the theme colours, so the logo follows any palette.
const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
export const LOGO_TOKENS = {
  Y: ['var(--accent2,#facc15)', '#facc15'],
  y: [mix('var(--accent2,#facc15)', 55, 'white'), '#fde68a'],
  A: ['var(--lane1,#38bdf8)', '#38bdf8'],
  a: [mix('var(--lane1,#38bdf8)', 55, 'white'), '#a5e1fb'],
  B: ['var(--lane3,#f472b6)', '#f472b6'],
  b: [mix('var(--lane3,#f472b6)', 55, 'white'), '#f9c0dc'],
  W: ['var(--ink,#f4f1ff)', '#f4f1ff'],
  M: [mix('var(--ink,#f4f1ff)', 65, 'var(--bg,#0b0b16)'), '#a3a0b4'],
  R: ['var(--accent,#ff5d5d)', '#ff5d5d'],
  H: ['var(--hi,#ffb3b3)', '#ffb3b3'],
  L: ['#ffffff', '#ffffff'],
  D: ['var(--accent-deep,#b91c1c)', '#b91c1c'],
  E: [mix('var(--accent-deep,#b91c1c)', 60, 'black'), '#6f1111'],
  O: [mix('var(--bg,#0b0b16)', 60, 'black'), '#06060d'],
};

// themed=true colours pixels with CSS variables so the logo follows the
// user's theme; themed=false bakes in the default colours (for PNG icons).
export function logoSvg({ size = 64, themed = true, bg = null, pad = 0 } = {}) {
  const w = LOGO_PIXELS[0].length;
  pad *= w / 16; // pad is given in old 16-px logo units
  const n = w + pad * 2;
  let rects = '';
  LOGO_PIXELS.forEach((row, y) => {
    if (row.length !== w) throw new Error(`logo row ${y} is ${row.length} wide`);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const [css, fallback] = LOGO_TOKENS[ch];
      const fill = themed ? `style="fill:${css}"` : `fill="${fallback}"`;
      const steam = 'YAByab'.includes(ch) ? ` class="st st${ch.toUpperCase()}"` : '';
      rects += `<rect${steam} x="${x + pad}" y="${y + pad}" width="1.02" height="1.02" ${fill}/>`;
    });
  });
  const back = bg ? `<rect width="${n}" height="${n}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="bitrecipe">${back}${rects}</svg>`;
}
