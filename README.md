# bitrecipe — Recipes, but chunkier.

The 128bit family's pixel recipe scraper. Landing page + working mock live at https://hootywhooo86.github.io/bitrecipe/

## What it is

A chunky, game-like recipe app for the 128bit family: paste any recipe link, get a clean readable card — title, time, servings, ingredients you can check off, steps you can tap done. No pop-ups, no 2,000-word life story before the ingredients, no ads in the middle of the steps. The mock on the landing page does all of that (with three sample recipes): paste a link or tap a sample, scale servings and watch amounts change, check off ingredients, tap steps done, watch the quest bar move, toggle cook mode.

## Relationship to 128bitlife and the family cookbook

bitrecipe is the family's cookbook. Finished recipes pay XP into 128bitlife, cook streaks and new-cuisine badges live there too, and saved recipes can flow into the family timeline and bitcalendar meal plans — cooking is one more quest source in the family game, not a separate silo.

## The app (v1, Android APK)

The real app lives in `app/` and is wrapped as an Android APK with Capacitor. Everything is in the 128-bit pixel style and every colour can be changed.

- **Share sheet import.** Share a TikTok, Reel or recipe page from any app to bitrecipe, or paste a link or text.
  - Recipe sites: reads the schema.org/Recipe data embedded in the page, falling back to the page description.
  - TikTok: reads the caption through TikTok's public oEmbed endpoint.
  - Instagram: reads the post caption when Instagram exposes it.
  - Plain text: section and quantity rules turn captions, notes or messages into a recipe.
- **Review before saving.** Every import goes through a check screen. Missing amounts are flagged `??` and never guessed; suggested amounts are kept separate from what the source said. Tracks, timers and step order are all editable.
- **Track Map**, bitrecipe's own recipe grid (see below), plus a plain numbered list.
- **Amounts inside every step** ("Whisk **2¼ cups flour**…"), scaled by the servings stepper and switchable between *as written*, *metric* and *US cups*. Cups↔grams uses per-ingredient densities, not one blanket number.
- **Before you start:** an equipment list and a prep checklist (minced, softened, melted…).
- **Cook mode:** one big step at a time, screen kept awake, named timers that keep running across steps (with a pixel beep and vibration), and +50 XP with confetti at the end.
- **My version:** copies a recipe so you can change it while the original stays untouched.
- **Colours:** six presets plus a custom colour for every token, with a contrast check and a one-tap "fix readability". The logo recolours with the theme.
- **Private by default.** Recipes stay on the phone (localStorage). Each recipe keeps its creator, original link and video timestamps.

### Track Map (our grid)

Cooking for Engineers draws a wide table: ingredients on the left, with steps as boxes that span them. It works on paper, but it is cramped on a phone and it cannot show what happens at the same time. The Track Map is vertical and built for phones:

- Every bowl, pan or job is a **track** (Dry bowl, Mixer, Oven), drawn as a pixel rail.
- Each track has its own letter **and** its own line pattern (solid, dashed or dotted), so colour is never the only difference.
- Steps hang off their track in the order you do them.
- When two things combine, one rail physically **joins** the other ("⤵ Dry bowl joins here").
- When rails run side by side, you can do both steps at once; a "⇉ while Oven" tag marks these.
- Hands-off steps (chill, bake, rest) are dashed and get a one-tap named timer.
- The card header shows the most tracks running at once ("2× at once").

Imported recipes get their tracks guessed from phrases like "meanwhile", "in a separate bowl", "preheat", "add the mixture to the pan" and "bake". You can fix them on the review screen.

### Logo

`app/logo.svg` (source: `app/js/logo.js`) is a 16×16 pixel pot whose two steam lanes merge into one yellow bit: the Track Map in miniature. `npm run icons` renders it into the Android icons and splash screens in `assets/`.

### Getting the APK

- **From GitHub:** every push that touches the app runs `.github/workflows/android.yml`. Open the run under the **Actions** tab and download the `bitrecipe-apk` artifact, which contains `bitrecipe-debug.apk`. Copy it to your phone and allow "install unknown apps".
- **Locally** (needs the Android SDK and Java 17): `npm install && npm run android:build`. The APK is written to `android/app/build/outputs/apk/debug/`.
- **Browser preview:** `npm run serve`, then open http://localhost:8080. Link import only works inside the APK, because browsers block reading other sites. Pasted text works everywhere.

Native bits live in `native/android/`: the share-sheet receiver and keep-screen-awake. `scripts/android-setup.sh` copies them into the generated project and registers the share intent.

### Not in v1 yet (honest list)

- Reading **spoken** steps and **on-screen text** from videos. That needs speech-to-text, OCR and an AI pass on a server. For now, TikTok and Reels use the caption, and you can paste anything else.
- Screenshot and video upload import (same server work).
- Grocery list across recipes, pantry, meal plans in bitcalendar, family sharing and sync. Events (`recipe.scraped`, `recipe.saved`, `recipe.cooked`) are already queued locally in the `family_events` shape, ready for Supabase sync.
- A signed release APK for the Play Store. CI builds a debug APK.

## Architecture

- One 128bit account + the shared family event feed (`supabase/family-feed.sql` — same `family_events` schema as the rest of the family). bitrecipe emits `recipe.scraped` / `recipe.cooked` / `recipe.saved` / `streak.milestone` events so quests, the family timeline, and bitcalendar can subscribe.
- `app/` is plain HTML, CSS and ES modules with no build step: `parse.js` (import), `units.js` (scaling and conversion), `trackmap.js` (the grid), `theme.js`, `logo.js` and `app.js` (screens).
- Capacitor 6 wraps `app/` as the Android app. `CapacitorHttp` lets the APK fetch recipe pages without the browser's cross-site block.

## Decisions taken (from the old open questions)

- **Scraping:** JSON-LD first, then page description or caption, then pasted text. Blocked or empty sources produce a clear flag and a paste fallback.
- **Saved data:** the cleaned card plus the original link, creator and timestamps. Units have three modes: as written, metric and US.
- **Scaling:** yes, in v1. "To taste" amounts stay as words, and pinches and cloves scale as counts.
- **Cook mode:** yes, in v1.
- **Collections:** a personal cookbook with search in v1; the shared family cookbook comes later.
- **Offline:** recipes and fonts are stored on the device, so cooking works offline.
- **Platform:** Android first, as a wrapped web app (Capacitor). iOS can reuse the same `app/`.

## Status

- Landing page + mock: live (coming-soon). Formspree ID still needed in the waitlist form (`YOUR_FORM_ID` placeholder with a local-confirm fallback).
- App v1: built in `app/`, with the APK built by CI.
