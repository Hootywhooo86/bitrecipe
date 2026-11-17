# The 128bit look

bitrecipe is the reference for every 128bit app. "128-bit" means detailed pixel
art in the style of late 16/32-bit console games: fine pixels with shading and
outlines, not chunky 8-bit blocks. Copy these rules (and the files listed) into
other 128bit projects.

## Type
- **Pixel font: Jersey 10** (SIL Open Font License, `app/fonts/Jersey10.woff2` + `Jersey10-OFL.txt`).
  Load it once with `size-adjust: 135%` so ordinary CSS sizes read well:
  ```css
  @font-face { font-family: 'Pixel'; src: url('../fonts/Jersey10.woff2') format('woff2'); font-display: swap; size-adjust: 135%; }
  :root { --px: 'Pixel', ui-monospace, monospace; }
  ```
- Use it for headings, buttons, labels, numbers and tags, at 12–21px. It has one weight:
  never fake-bold it (`font-synthesis: none`).
- Body text, ingredient lists and long reading stay in the system sans-serif.
- Don't use Press Start 2P or other 8-bit block fonts.

## Pixel art
- **Logos are 32×32 pixels**, sprites 14–20 px wide, drawn as text maps (one letter per
  pixel) and rendered as SVG `<rect>`s with `shape-rendering="crispEdges"`, so they stay sharp at any size.
- Every sprite has a **dark outline** (`O`), a **base colour**, a **shade** (`D`/`E`) on the
  lower right, a **highlight** (`H`) on the upper left and a 1–2 px **white shine** (`L`).
- Colours come from the theme tokens. Shades are mixed from them, so art follows whatever
  colours the user picks:
  `color-mix(in srgb, var(--accent-deep) 60%, black)` for deep shade,
  `color-mix(in srgb, var(--accent2) 55%, white)` for light tints.
  Keep a plain hex fallback for each letter for exported PNGs (icons, share cards).
- See `app/js/logo.js` (logo + tokens) and `app/js/sprites.js` (chef, flame, trophy).

## UI chrome
- Borders 2px, solid or dashed. Hard drop shadows of 3px (`3px 3px 0 #0006`), never blurred.
- Buttons: flat colour with a 3px darker "ledge" underneath (`box-shadow: 0 3px 0 var(--accent-deep)`).
- Motion uses `steps()` timing (pixel-snappy), and respects reduced motion.
- Colours are always user-changeable: everything reads CSS variables
  (`--bg --panel --ink --muted --edge --accent --accent-deep --accent2 --lane1..3 --good`).
