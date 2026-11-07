# bitrecipe — Recipes, but chunkier.

The 128bit family's pixel recipe scraper. Landing page + working mock live at https://hootywhooo86.github.io/bitrecipe/

## What it is

A chunky, game-like recipe app for the 128bit family: paste any recipe link, get a clean readable card — title, time, servings, ingredients you can check off, steps you can tap done. No pop-ups, no 2,000-word life story before the ingredients, no ads in the middle of the steps. The mock on the landing page does all of that (with three sample recipes): paste a link or tap a sample, scale servings and watch amounts change, check off ingredients, tap steps done, watch the quest bar move, toggle cook mode.

## Relationship to 128bitlife and the family cookbook

bitrecipe is the family's cookbook. Finished recipes pay XP into 128bitlife, cook streaks and new-cuisine badges live there too, and saved recipes can flow into the family timeline and bitcalendar meal plans — cooking is one more quest source in the family game, not a separate silo.

## Architecture

- One 128bit account + the shared family event feed (`supabase/family-feed.sql` — same `family_events` schema as the rest of the family). bitrecipe emits `recipe.scraped` / `recipe.cooked` / `recipe.saved` / `streak.milestone` events so quests, the family timeline, and bitcalendar can subscribe.
- Landing page is a static mock only; the real app build is Carlos's lane (see below).

## Open product questions (Daniel's call)

- **How does scraping work?** Parse recipe structured data (schema.org/Recipe JSON-LD) first, fall back to HTML parsing? What happens on sites that block scrapers or have no structured data?
- **What gets saved?** Just the cleaned card, or the original link + a snapshot too? How are units handled — metric/imperial toggle, or keep as written?
- **Serving scaler:** scale amounts by servings in v1? How are "to taste" / pinch / clove-type amounts handled?
- **Cook mode:** big text, screen stays awake, step-by-step — in v1 or later?
- **Collections:** personal cookbook only, or shared family cookbook? Tags, search, and meal planning in v1?
- **Offline:** save recipes for offline cooking, or online-only?
- **Platform:** iOS/Android/both, native build or wrapped web app?

## Status

- Landing page + mock: live (coming-soon).
- Real app build: not started. Formspree ID still needed in the waitlist form (`YOUR_FORM_ID` placeholder with a local-confirm fallback).
