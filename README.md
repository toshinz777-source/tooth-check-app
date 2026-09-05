# Tooth Check

A mobile-first web app that helps users gauge how urgently they should see a
dentist based on their symptoms. It does not diagnose dental conditions — it
only provides general guidance and encourages professional dental care when
appropriate.

## Features

- Step-by-step symptom check (location, triggers, pain level, duration,
  frequency, night pain, swelling, fever, pus/discharge, swallowing/breathing
  difficulty)
- Optional **Photo Check** step: take a photo with the camera or upload one,
  then record what you notice from a checklist of visible warning signs
  (broken tooth, discoloration, swelling, bleeding, pus, redness, trauma,
  etc.). This is a manual checklist, not automated image analysis — see
  Photo Check & privacy below.
- Four-level guidance that combines the questionnaire, the photo checklist,
  and a set of red-flag symptoms (which always override everything else):
  Low urgency, Book a Dentist Soon, Urgent Dental Assessment, and
  Seek Urgent Medical or Dental Care Now
- Symptom history saved locally in the browser (`localStorage`)
- Simple trend detection that flags worsening symptoms
- One-tap dentist summary you can copy and share

## Photo Check & privacy

Photo Check does **not** perform automated image diagnosis — doing that
reliably would require sending your photo to an external AI service, which
this app deliberately avoids. Instead, `analyzeDentalPhoto()` records which
visible signs *you* select from a checklist, and `calculateCombinedUrgency()`
weighs those alongside your questionnaire answers and any red-flag symptoms.

- Photos are processed entirely on your device and are never uploaded to a
  server, sent to a third party, or used for analytics.
- Photos are **not saved by default**. You can choose "Keep this photo" to
  attach it to that entry's history (still stored only in your browser's
  `localStorage`), or use "Delete Photo" to discard it immediately.

## Tech

Plain HTML, CSS, and JavaScript. No build step, no backend, no login, no
external APIs — everything is stored in the browser's `localStorage`. The
camera uses the standard `getUserMedia` API; no third-party camera or image
libraries are used.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploy to GitHub Pages

This repo includes a ready-to-use GitHub Actions workflow
(`.github/workflows/deploy-pages.yml`) that publishes the app straight from
the `claude/repository-selection-tooth-check-tsj0f2` branch — no need to
merge into `main` first.

One-time setup:

1. In the repository, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to "GitHub Actions".
3. Push to (or re-run the workflow on) `claude/repository-selection-tooth-check-tsj0f2`
   and the site will publish at
   `https://<username>.github.io/<repository-name>/`.

If you'd rather deploy from a different branch (e.g. after merging into
`main`), you can instead set **Source** to "Deploy from a branch" and pick
that branch's `/ (root)` folder — no build configuration is required either
way since the app is static HTML/CSS/JS.

## Disclaimer

This app does not diagnose dental conditions and is not a substitute for a
dentist or doctor.
