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
- **Timer alarms:** in the Android app every timer is a real alarm. It rings with the alarm sound when the app is closed or the screen is off, keeps ringing until you tap STOP, and is set to get through Do Not Disturb. Settings › Timer alerts asks for notification permission, exact timing and Do Not Disturb access, and has a 10-second test.
- **Pinterest boards:** follow a public board in Settings. New pins that link to a recipe are imported automatically (board RSS → pin → recipe site → recipe data) and marked NEW for a quick check. bitrecipe checks when you open it. TikTok and Instagram don't let apps read saved collections, so those use the share sheet.
- **Animations:** steam on the logo, bubbling timer pots with progress bars, screens and Track Map steps popping in, cook-mode wipes, a check-off pop and an arcade XP count-up. A Calm switch in Settings turns them off, and the phone's reduce-motion setting is respected.
- **Grocery list:** tap 🛒 on any recipe card, or tick what you already have on a recipe and tap "Add missing to list". Everything merges into one list sorted by aisle ("2 eggs + 2 eggs = 4 eggs"; cups and grams of the same ingredient combine). Shows which recipe each item is for, has tick-off with a progress bar, extra items, clear ticked, and share as text.
- **XP, levels and badges:** cook +50, save +10, your own version +15, first grocery list +5. Seven chef levels and ten badges, with drop-in banners and a level-up celebration. Events (`xp.earned`, `level.up`, `badge.unlocked`) are queued for 128bitlife.
- **Photos:** a recipe's photo (from the page, pin or TikTok cover) is saved with the recipe as a 640px JPEG (~30 KB), so it survives expired links and syncs quickly.
- **Testing tools:** "This import went wrong" shares a full report (input, what was found, what was made); Settings has backup/restore to a file, the version number, and an update check against GitHub Releases.
- **128bit account sync:** Settings › 128bit account signs in with the same email and password as 128bit Play, Tracker and FIT (the "128bit play" Supabase project). Recipes, grocery list, XP, badges, colours and followed boards sync across devices: on open, a few seconds after changes, and on "Sync". The newest edit wins per item, XP and badges merge, and deletions sync. Sharing cooking to the family feed (Tracker's timeline) is a separate switch, off by default. Server setup: run `supabase/bitrecipe-sync.sql` once.
- **What can I make?** Tap the ingredients you have (salt, pepper, oil and water assumed). Recipes sort by how few things are missing, with a 🛒 button that adds just the missing ones to the grocery list.
- **Collections and favourites:** ★ favourite any recipe and tag it (Dinner, Dessert, Breakfast, Quick, Baking, Snack or your own); filter chips on the home screen.
- **Family cookbook:** Settings › Family cookbook makes a shared book with a 6-letter code (or joins one). Share any recipe to it with 👪; everyone in the book sees it under the 👪 FAMILY filter and can cook it or save their own copy. Server setup: run `supabase/bitrecipe-family.sql` once.
- **Share card:** 📤 turns a recipe into a picture (photo, ingredients with amounts, numbered steps, theme colours) to send to anyone.
- **Hands-free cook mode:** 🎙 listens for "next", "back", "repeat", "start timer", "stop" and "ingredients"; 🔊 reads each step aloud. Uses the phone's own speech recognition and voice.
- **Write your own:** ✍ on the home or add screen opens a blank recipe. Type ingredients as you'd say them; mentioning one in a step puts its amount there. Add timers, hands-off steps, tracks, and a photo from the camera or gallery. Optionally share it to the family cookbook as you save (+25 XP, "Original Chef" badge).
- **AI Chef:** ✨ on the home screen. Say what you want to make (plus servings, time, diet/allergies, and optionally "use what's in my fridge"), pick an engine (**Gemini** is first and the default, then **OpenRouter** free models, **Groq**, **Cerebras** and **Claude**), and get a full bitrecipe-format recipe with tracks, amounts in steps, timers and chef's tips. It opens in the editor to check before saving. **✨ AI Tweak** on any recipe reworks it ("make it vegetarian"). The keys stay on the server: the `bitrecipe-ai` Supabase Edge Function (`supabase/functions/bitrecipe-ai/`) calls Claude (`claude-opus-5-5`, strict JSON schema) Groq (`openai/gpt-oss-120b`, strict JSON schema) Gemini (newest stable Flash model the key can use, found via Google's model list; `GEMINI_MODEL` overrides), Cerebras (`gpt-oss-120b`) or OpenRouter (picks the best free model from OpenRouter's live list that supports structured outputs, falling back to the next one; only providers that honour the schema). If Gemini fails (busy, slow or a model error), the same request automatically moves on to OpenRouter's free models, and the editor shows a note saying the backup made it; refusals and key problems don't hop engines. Every engine falls back to schema-in-the-instructions if strict output isn't supported, and the reply is normalised into a valid recipe. Models can be changed with the `GROQ_MODEL`, `GEMINI_MODEL`, `CEREBRAS_MODEL` and `OPENROUTER_MODEL` secrets, with a per-account daily limit (`supabase/bitrecipe-ai.sql`, default 25/day; failed attempts are given back, so only recipes that arrive count). **🔍 Check engines** on the AI Chef screen runs a tiny test recipe through every engine with a key and shows ✓/✗, time, model and the error. A failed engine gets **↻ Find a working model** (tries the engine's other models until one makes a recipe, then remembers it), and every engine has a model list with **Test** and **Use this model**. Model picks sync with your 128bit account. Setup: run that SQL, then add any of the Edge Function secrets `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`.
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

- **Updates install over the top:** every build is signed with the same key (`native/android/debug.keystore`, a test key, not for the Play Store), so new versions keep your recipes. Builds before v0.1.8 used throwaway keys: uninstall those once.
- **From GitHub Releases:** every push that touches the app builds the APK and publishes it as a new release (v0.1.N). The newest is always at https://github.com/Hootywhooo86/bitrecipe/releases/latest/download/bitrecipe-debug.apk. Open that on your phone and allow "install unknown apps".
- **Locally** (needs the Android SDK and Java 17): `npm install && npm run android:build`. The APK is written to `android/app/build/outputs/apk/debug/`.
- **Browser preview:** `npm run serve`, then open http://localhost:8080. Link import only works inside the APK, because browsers block reading other sites. Pasted text works everywhere.

Native bits live in `native/android/`: the share-sheet receiver, keep-screen-awake, theme-coloured system bars, and alarm timers (`TimerReceiver`, its alarm channel, and the permissions). `scripts/android-setup.sh` copies them into the generated project and registers the share intent.

### Not in v1 yet (honest list)

- Reading **spoken** steps and **on-screen text** from videos. That needs speech-to-text, OCR and an AI pass on a server. For now, TikTok and Reels use the caption, and you can paste anything else.
- Screenshot and video upload import (same server work).
- Pantry, meal plans in bitcalendar, and Google sign-in (needs a bitrecipe return link added to the Supabase sign-in settings).
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
