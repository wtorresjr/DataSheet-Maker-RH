# DataSheet-Maker-RH

An Electron desktop app that reads treatment-plan programs and targets from
Raven Health (`app.ravenhealth.com`) and builds a printable, landscape session
**data sheet** — replacing the manual Word/PDF process.

Flow: **Log in → Open a care plan → Create Data Sheet → Set Parameters → Build → Print / Save as PDF**

## Running it

```
npm install
npm start
```

The app opens with two tabs:

- **Raven** — an embedded browser. Log in here; the session is kept in a
  persistent partition, so you stay logged in across restarts. Navigate to a
  client's `.../care-plan` page and **Create Data Sheet** becomes enabled.
- **Builder** — parameters, then the sheet preview.

**Save as PDF** writes the file directly through a native save dialog (landscape
Letter, 0.3in margins). **Print** opens the system print dialog. **New Sheet**
clears everything — the loaded plan, your tuned parameters, the built sheet, and
the saved `last-plan.json` — so the next client starts from a blank slate.

The status line always names the extraction path that ran (`database` or
`page scrape`), the reason for any fallback, and the care plan's own program
count when it disagrees with the database count.

The last extracted plan is kept in `last-plan.json` under the app's userData
directory, so reopening the app rehydrates it. With nothing stored, the builder
shows an empty state with a **Load sample data** button that populates it from a
real exported plan (`scraper-output.csv`, regrouped into
`src/renderer/builder/sample-data.js`).

## Program types → sheet widgets

| Program Type | Parameter | Rendered widget |
| --- | --- | --- |
| Behavior \| Frequency | none | large tally box (~150 marks) |
| Behavior \| Rate | none | large tally box (~150 marks) |
| Behavior \| Interval | Number of intervals | a row of N boxes |
| Behavior \| Duration | Number of slots | N numbered write-in lines |
| Skill \| Trial By Trial | Minimum Number of Trials (program-level) | per target: graph-paper row of N cells + "Additional trials" box |
| Skill \| Task Analysis | Number of Steps | a row of N +/- boxes |

Behaviors render in a full-width band across the top of page 1; skills flow in
columns below.

## How the plan is extracted

Two paths, tried in order by [`src/main/extract.js`](src/main/extract.js):

1. **`src/inject/db-read.js` — the local database.** Raven runs WatermelonDB on
   a LokiJS adapter, and its `programs` / `targets` tables sync in full, so the
   whole care plan is already in memory. The script finds any WatermelonDB
   record in the live React fiber tree *by shape* (it carries `._raw`), climbs
   to the Loki store, and reads the rows directly. No clicking, no waiting.

   Three filters are load-bearing, and dropping any one silently corrupts the
   sheet:

   - **`deleted_at`** — rows are soft-deleted and WatermelonDB's `_status`
     still reads `"synced"` on them, so the ORM does not hide them.
   - **`patient_id`** — `programs` holds every program twice, once assigned to
     the patient and once as the org library template with an empty
     `patient_id`.
   - **`state !== "archived"`** — Raven marks a program `archived` once the
     client has mastered it and staff stop recording data for it. Archived rows
     live in the store forever: on one real client, 82 rows for 56 live
     programs. This is excluded rather than keeping only `state === "active"`
     on purpose — an unexpected state leaves a program *on* the sheet where it
     is visible and can be unchecked, whereas silently dropping one means data
     never gets collected for it.

2. **`src/inject/dom-scrape.js` — the legacy DOM scraper.** Used automatically
   if the database read can't find a handle. This is the old Chrome-extension
   scraper, kept near-verbatim: it anchors on inline `font-family` styles
   (Raven's generated class names are not stable), and for each Trial By Trial
   program it clicks a targets modal open, waits, reads, and clicks it closed —
   roughly 20s for a 40-program plan. Its selectors are deliberately unchanged;
   this path exists to be the known-working behavior.

This was previously a Chrome extension. The move to Electron is what makes path
(1) possible at all: a content script runs in Chrome's ISOLATED world and cannot
see the `__reactFiber$…` properties React attaches to DOM nodes, whereas
Electron's `webContents.executeJavaScript` runs in the page's main world.

## Diagnosing a wrong program list

If a sheet contains programs that are not on the client's current care plan, the
database filter is letting extra rows through. Run:

```
npm run diagnose
```

This opens Raven in your normal saved session. Navigate to the client's care
plan and the diagnostic runs automatically — it is read-only, and clicks
nothing. It prints the program count at each filter stage, the row counts per
`patient_id`, and the diff between what the database returns and what the page
actually renders (scrolling first, so a virtualized list is not mistaken for
missing programs). Crucially it reports **which fields, if any, cleanly separate
the on-plan programs from the extra ones** — that field is the filter the
extraction is missing. The full report is written to `diagnostics/`.

## Project layout

```
src/
  main/
    main.js            app lifecycle, window, Raven session partition
    ipc.js             IPC handlers behind window.rhAPI
    extract.js         db-read -> dom-scrape orchestration, timeouts, progress
    store.js           last-plan.json persistence
    print.js           print() / printToPDF() + save dialog
  preload/preload.js   contextBridge -> window.rhAPI
  inject/
    db-read.js         WatermelonDB/LokiJS read (preferred)
    dom-scrape.js      legacy DOM scraper (fallback)
  renderer/
    index.html         app shell: toolbar + <webview> + builder
    app.js             tab switching, Raven nav state, extraction
    app.css            shell chrome only
    builder/
      builder.js       params UI, sheet builder, print handlers
      builder.css      screen styles (toolbar, params form, preview frame)
      sheet.css        the sheet's visual language (cards, grids, boxes)
      print.css        @page landscape + print-only overrides
      sample-data.js   dev sample plan (generated from scraper-output.csv)
tools/
  diagnose.js          `npm run diagnose` runner (opens Raven, writes a report)
  diagnose-inject.js   the read-only page inspection it injects
icons/                 placeholder icons (16/48/128)
```

`treatment-plan-scraper-script.js` is the original TamperMonkey userscript the
DOM scraper descends from, kept for provenance.

## Packaging

Not configured yet. The project has no bundler and no runtime dependencies, so
`electron-builder` can be added later without restructuring.
