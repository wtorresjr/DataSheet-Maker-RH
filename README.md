# DataSheet-Maker-RH

A Chrome extension (Manifest V3) that scrapes treatment-plan programs and targets
from Raven Health (`app.ravenhealth.com`) and builds a printable, landscape
session **data sheet** — replacing the manual Word/PDF process.

Flow: **Scrape → Set Parameters → Build → Print / Save as PDF**

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
columns below. Both **Print** and **Save as PDF** use the browser's native print
dialog with landscape print styling (choose "Save as PDF" as the destination).

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this project folder.
4. Navigate to a Raven Health `.../care-plan` page. A blue **Create Data Sheet**
   button appears bottom-right. Click it to scrape and open the builder.

## Try it without Raven

Open the builder page directly (from `chrome://extensions`, click the
extension's **service worker** / details, or open
`chrome-extension://<id>/src/builder/builder.html`) and click **Load sample
data** to populate the builder from a real exported plan
(`scraper-output.csv`, regrouped into `src/builder/sample-data.js`).

## Project layout

```
manifest.json
src/
  background.js            service worker: opens the builder tab after a scrape
  content/scrape.js        injects the button + scrapes programs/targets
  builder/
    builder.html           Parameters + Preview single-page app
    builder.js             params UI, sheet builder, print handlers
    builder.css            screen styles (toolbar, params form, preview frame)
    sheet.css              the sheet's visual language (cards, grids, boxes)
    print.css              @page landscape + print-only overrides
    sample-data.js         dev sample plan (generated from scraper-output.csv)
icons/                     placeholder icons (16/48/128)
```

The scraping logic is ported from the original TamperMonkey userscript
(`treatment-plan-scraper-script.js`), keeping the structured
`{title, type, targets[]}` shape the builder needs.

## Regenerating sample data

```
python - <<'PY'
# see the grouping script; reads scraper-output.csv, writes src/builder/sample-data.js
PY
```
