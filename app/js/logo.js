// bitrecipe logo: a pixel pot whose two steam "lanes" merge into one bit.
// It is the Rail view in miniature: two tracks of work joining into one dish.
// Pure module (no DOM) so the icon script in /scripts can import it too.

export const LOGO_PIXELS = [
  '.......YY.......',
  '.......YY.......',
  '....AAAYYBBB....',
  '....AA....BB....',
  '....AA....BB....',
  '....AA....BB....',
  '................',
  '.WWWWWWWWWWWWWW.',
  '..RRRRRRRRRRRD..',
  'DDRHRRRRRRRRRDDD',
  'DDRHRRRRRRRRRDDD',
  '..RHRRRRRRRRRD..',
  '..RRRRRRRRRRRD..',
  '..DDDDDDDDDDDD..',
  '...DDDDDDDDDD...',
  '................',
];

// Theme token each pixel letter maps to, with the default "Tomato" colour.
export const LOGO_TOKENS = {
  Y: ['--accent2', '#facc15'],
  A: ['--lane1', '#38bdf8'],
  B: ['--lane3', '#f472b6'],
  W: ['--ink', '#f4f1ff'],
  R: ['--accent', '#ff5d5d'],
  H: ['--hi', '#ffb3b3'],
  D: ['--accent-deep', '#b91c1c'],
};

// themed=true colours pixels with CSS variables so the logo follows the
// user's theme; themed=false bakes in the default colours (for PNG icons).
export function logoSvg({ size = 64, themed = true, bg = null, pad = 0 } = {}) {
  const n = 16 + pad * 2;
  let rects = '';
  LOGO_PIXELS.forEach((row, y) => {
    if (row.length !== 16) throw new Error(`logo row ${y} is ${row.length} wide`);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const [token, fallback] = LOGO_TOKENS[ch];
      const fill = themed ? `style="fill:var(${token},${fallback})"` : `fill="${fallback}"`;
      const steam = 'YAB'.includes(ch) ? ` class="st st${ch}"` : '';
      rects += `<rect${steam} x="${x + pad}" y="${y + pad}" width="1.02" height="1.02" ${fill}/>`;
    });
  });
  const back = bg ? `<rect width="${n}" height="${n}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="bitrecipe">${back}${rects}</svg>`;
}
