# Tooth Check

A mobile-first web app that helps users gauge how urgently they should see a
dentist based on their symptoms. It does not diagnose dental conditions — it
only provides general guidance and encourages professional dental care when
appropriate.

## Features

- Step-by-step symptom check (location, triggers, pain level, duration,
  frequency, night pain, swelling, fever, pus/discharge, swallowing/breathing
  difficulty)
- Three-level guidance: Monitor / Routine Dental Check, Book a Dentist Soon,
  Urgent Dental Care
- Symptom history saved locally in the browser (`localStorage`)
- Simple trend detection that flags worsening symptoms
- One-tap dentist summary you can copy and share

## Tech

Plain HTML, CSS, and JavaScript. No build step, no backend, no login, no
external APIs — everything is stored in the browser's `localStorage`.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploy to GitHub Pages

1. Push this repository to GitHub (already done if you're reading this from
   the repo).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch".
4. Choose the branch you want to publish (e.g. `main`) and the `/ (root)`
   folder, then save.
5. GitHub Pages will publish the site at
   `https://<username>.github.io/<repository-name>/`.

No build configuration is required since the app is static HTML/CSS/JS.

## Disclaimer

This app does not diagnose dental conditions and is not a substitute for a
dentist or doctor.
