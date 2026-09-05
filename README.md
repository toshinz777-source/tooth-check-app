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
  etc.).
- Optional, **experimental on-device AI photo analysis** (`js/dental-ai.js`,
  ONNX Runtime Web) that can flag the same kind of visible features
  automatically, each with a confidence score — see AI Photo Analysis below.
- Four-level guidance that combines the questionnaire, the photo checklist,
  the AI result, and a set of red-flag symptoms (which always override
  everything else): Low urgency, Book a Dentist Soon, Urgent Dental
  Assessment, and Seek Urgent Medical or Dental Care Now
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

## AI Photo Analysis (experimental)

`js/dental-ai.js` implements on-device dental photo analysis using
[ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/), preferring
the WebGPU execution provider and automatically falling back to WebAssembly
when WebGPU isn't available. All inference — preprocessing, the forward
pass, and interpreting the output — runs locally in the browser. The photo
is never uploaded anywhere, and no analytics or cloud AI APIs are used.

**No medically validated dental model is currently included.** See
`models/README.md` for the expected model file, input/output shape, and
category list. Until a model is added, the feature safely shows
"Experimental — dental-specific AI model not yet installed" instead of
fabricating a result. The rest of the app (questionnaire, manual photo
checklist, history, trend detection, summary) works fully without it.

The AI never diagnoses a condition — it only reports visible features (e.g.
"visible dark area") with a confidence score, using wording like "This can
have several causes and should be checked by a dentist," never "You have a
cavity." A result is only shown when image quality (brightness, blur,
resolution) passes a basic check, and an uncertain or low-confidence result
is always labeled as such rather than presented as fact. The AI result can
raise the questionnaire's urgency level (e.g. a confident finding on an
otherwise mild questionnaire) but can never downgrade or override an
emergency red flag (breathing/swallowing difficulty, fever with swelling,
etc.) — see `calculateCombinedUrgency()` in both `app.js` and
`js/dental-ai.js`.

## Tech

Plain HTML, CSS, and JavaScript. No build step, no backend, no login, no
API keys, no environment variables — everything is stored in the browser's
`localStorage`. The camera uses the standard `getUserMedia` API.

The one external dependency is the ONNX Runtime Web *library* itself
(loaded from a CDN, only when the AI feature actually runs) — this is
generic runtime code, not user data, and no photo or personal data is ever
sent to that CDN or anywhere else. If you need a fully offline build,
vendor `onnxruntime-web`'s `dist/` files into this repo and update
`ORT_SCRIPT_URL` in `js/dental-ai.js`.

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
