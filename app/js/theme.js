// Themes. Every colour in the app (and the logo) is a CSS variable, so any
// preset or custom palette repaints everything. Custom palettes get a
// contrast check so text can't become unreadable.

export const TOKENS = [
  ['bg', 'Background'],
  ['panel', 'Panels'],
  ['edge', 'Borders'],
  ['ink', 'Text'],
  ['muted', 'Soft text'],
  ['accent', 'Main colour'],
  ['accent2', 'Highlight'],
  ['good', 'Done / OK'],
  ['lane1', 'Track A'],
  ['lane2', 'Track B'],
  ['lane3', 'Track C'],
];

export const PRESETS = {
  tomato: { name: 'Tomato', bg: '#0b0b16', panel: '#141428', edge: '#2a2a4a', ink: '#f4f1ff', muted: '#9a97b8', accent: '#ff5d5d', accent2: '#facc15', good: '#22c55e', lane1: '#38bdf8', lane2: '#facc15', lane3: '#f472b6' },
  pocket: { name: 'Pocket Green', bg: '#0f380f', panel: '#1f4f1f', edge: '#306230', ink: '#e0f8d0', muted: '#9bbc0f', accent: '#8bac0f', accent2: '#e0f8d0', good: '#c4f07a', lane1: '#e0f8d0', lane2: '#9bbc0f', lane3: '#5a8f29' },
  grape: { name: 'Midnight Grape', bg: '#120a1f', panel: '#1e1233', edge: '#3b2560', ink: '#f3e8ff', muted: '#a78bcb', accent: '#a855f7', accent2: '#22d3ee', good: '#4ade80', lane1: '#22d3ee', lane2: '#fb923c', lane3: '#f472b6' },
  ocean: { name: 'Deep Ocean', bg: '#04131f', panel: '#0a2236', edge: '#173a57', ink: '#e6f6ff', muted: '#7fa6c0', accent: '#0ea5e9', accent2: '#fcd34d', good: '#34d399', lane1: '#fcd34d', lane2: '#34d399', lane3: '#f87171' },
  paper: { name: 'Recipe Card', bg: '#f5ecd7', panel: '#fffaf0', edge: '#3a2f25', ink: '#2a2118', muted: '#6b5a48', accent: '#c2410c', accent2: '#a16207', good: '#15803d', lane1: '#1d4ed8', lane2: '#c2410c', lane3: '#7e22ce' },
  sunset: { name: 'Sunset Arcade', bg: '#1a0b14', panel: '#2b1020', edge: '#4c1d3a', ink: '#fff1e6', muted: '#d39bb0', accent: '#fb7185', accent2: '#fdba74', good: '#a3e635', lane1: '#fdba74', lane2: '#67e8f9', lane3: '#a3e635' },
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
function lum(hex) {
  return hexToRgb(hex)
    .map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function shade(hex, f) {
  return '#' + hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f))).toString(16).padStart(2, '0')).join('');
}

export function contrastReport(t) {
  return [
    ['Text on background', contrast(t.ink, t.bg)],
    ['Text on panels', contrast(t.ink, t.panel)],
    ['Soft text on panels', contrast(t.muted, t.panel), 3],
  ].map(([label, ratio, min = 4.5]) => ({ label, ratio, ok: ratio >= min, min }));
}

// Make text readable again: pick near-white or near-black ink.
export function fixContrast(t) {
  const out = { ...t };
  const dark = lum(t.panel) > 0.35;
  if (contrast(out.ink, out.bg) < 4.5 || contrast(out.ink, out.panel) < 4.5) out.ink = dark ? '#16110c' : '#f8f6ff';
  if (contrast(out.muted, out.panel) < 3) out.muted = dark ? '#5b5047' : '#b4b0cc';
  return out;
}

export function applyTheme(t) {
  const r = document.documentElement.style;
  for (const [k] of TOKENS) r.setProperty(`--${k}`, t[k]);
  r.setProperty('--accent-deep', shade(t.accent, -0.35));
  r.setProperty('--accent2-deep', shade(t.accent2, -0.4));
  r.setProperty('--good-deep', shade(t.good, -0.4));
  r.setProperty('--hi', shade(t.accent, 0.45));
  r.setProperty('--on-accent', contrast('#ffffff', t.accent) >= 3 ? '#ffffff' : '#120d08');
  r.setProperty('--on-accent2', contrast('#ffffff', t.accent2) >= 3 ? '#ffffff' : '#120d08');
  r.setProperty('--dot', t.accent + '14');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  document.documentElement.dataset.light = lum(t.bg) > 0.4 ? '1' : '';
}
