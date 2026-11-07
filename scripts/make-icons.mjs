// Renders the pixel logo into the PNGs @capacitor/assets turns into
// Android launcher icons and splash screens. Run: npm run icons
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { logoSvg } from '../app/js/logo.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BG = '#0b0b16';
mkdirSync('assets', { recursive: true });
writeFileSync('app/logo.svg', logoSvg({ size: 256, themed: false }));

const jobs = [
  ['assets/icon-only.png', 1024, logoSvg({ size: 1024, themed: false, bg: BG, pad: 3 }), BG],
  ['assets/icon-foreground.png', 1024, logoSvg({ size: 1024, themed: false, pad: 6 }), 'transparent'],
  ['assets/icon-background.png', 1024, '', BG],
  ['assets/splash.png', 2732, logoSvg({ size: 640, themed: false }), BG],
  ['assets/splash-dark.png', 2732, logoSvg({ size: 640, themed: false }), BG],
  ['assets/logo-512.png', 512, logoSvg({ size: 512, themed: false, bg: BG, pad: 2 }), BG],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, svg, bg] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg}">${svg}</body></html>`);
  await page.screenshot({ path: file, omitBackground: bg === 'transparent' });
  console.log('wrote', file);
}
await browser.close();
