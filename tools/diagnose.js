// `npm run diagnose` — opens Raven in the app's normal (already logged-in)
// session. Navigate to a client's care plan; when the page settles this runs
// tools/diagnose-inject.js against it, prints a summary, and writes the full
// report to a JSON file next to the project.
//
// Read-only. It inspects the local store and the rendered DOM; it never writes
// to Raven and never clicks anything.
const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, session } = require("electron");

const RAVEN_PARTITION = "persist:raven";
const CARE_PLAN_RE = /^\/clients\/[^/]+\/care-plan/;
const INJECT = path.join(__dirname, "diagnose-inject.js");
const OUT_DIR = path.join(__dirname, "..", "diagnostics");

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  `Chrome/${process.versions.chrome} Safari/537.36`;

let busy = false;

function summarise(r) {
  const line = (s) => console.log(s);
  line("");
  line("=".repeat(72));
  line(`CLIENT ${r.clientId}`);
  line("=".repeat(72));

  const c = r.counts;
  line("");
  line("Programs at each filter stage:");
  line(`  in the store, all patients .......... ${c.programsTotal}`);
  line(`  after !deleted_at ................... ${c.afterDeletedAt}`);
  line(`  after patient_id === this client .... ${c.afterPatientId}   <- what the app uses`);
  line(`  actually rendered on the care plan .. ${c.renderedOnPage}`);
  if (r.wasVirtualized) {
    line(`      (list was virtualized: ${c.renderedBeforeScrolling} before scrolling,`);
    line(`       ${c.renderedOnPage} after — scrolling revealed the rest)`);
  }
  line("");
  line(`  in DB and on the page ............... ${c.matchedDbAndPage}`);
  line(`  in DB but NOT on the page ........... ${c.inDbNotOnPage}   <- the over-inclusion`);
  line(`  on the page but NOT in DB ........... ${c.onPageNotInDb}`);

  line("");
  line("Rows per patient_id (top 15):");
  for (const p of r.patientCounts) {
    line(`  ${p.isCurrent ? "->" : "  "} ${String(p.count).padStart(5)}  ${p.patient_id}`);
  }

  const fp = r.filterPreview;
  line("");
  line("What each candidate filter would yield:");
  line(`  patient_id only (today) ............. ${fp.currentFilter_patientIdOnly}`);
  line(`  + state !== "archived" .............. ${fp.withStateNotArchived}   <- the app's filter`);
  line(`  + state === "active" only ........... ${fp.withStateActiveOnly}`);
  line(`  excluded as archived ................ ${fp.excludedAsArchived}`);
  if (fp.otherStates.length) {
    line(`  !! states that are neither active nor archived: ${fp.otherStates.join(", ")}`);
    line("     (an \"active only\" filter would silently drop these)");
  }

  line("");
  line("state, cross-tabbed against what the page renders:");
  for (const [v, c] of Object.entries(r.stateCrossTab)) {
    line(`  ${String(v).padEnd(12)} on page: ${String(c.onPage).padStart(3)}   not on page: ${String(c.notOnPage).padStart(3)}`);
  }

  line("");
  if (r.discriminators.length) {
    line(`FIELDS THAT CLEANLY SEPARATE on-page from not-on-page (${r.discriminators.length}):`);
    for (const d of r.discriminators) {
      line(`  ${d.field}`);
      line(`      on page     : ${d.onPageValues.join(", ")}`);
      line(`      NOT on page : ${d.notOnPageValues.join(", ")}`);
    }
  } else {
    line("NO single field cleanly separates the two groups.");
    line("Compare the sample rows in the JSON report by hand, or the split may");
    line("be driven by a join table rather than a column on `programs`.");
  }

  if (r.onPageNotInDb.length) {
    line("");
    line("On the page but missing from the DB query (filter may be too strict):");
    for (const t of r.onPageNotInDb.slice(0, 10)) line(`  - ${t}`);
  }

  line("");
  line(`Programs in the DB that are NOT on the care plan (${r.notOnPageTitles.length}):`);
  for (const t of r.notOnPageTitles.slice(0, 25)) line(`  - ${t}`);
  if (r.notOnPageTitles.length > 25) {
    line(`  ... and ${r.notOnPageTitles.length - 25} more (see the JSON report)`);
  }
}

async function runDiagnostic(contents) {
  if (busy) return;
  busy = true;
  try {
    // Let Raven finish rendering the care plan before reading the DOM.
    await new Promise((r) => setTimeout(r, 3000));

    const report = await contents.executeJavaScript(fs.readFileSync(INJECT, "utf8"), false);

    if (!report || !report.ok) {
      console.log(`\n[diagnose] could not run: ${report && report.reason}`);
      console.log("[diagnose] give the page another moment, then reload it.");
      return;
    }

    summarise(report);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `programs-${report.clientId}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), "utf8");
    console.log(`\n[diagnose] full report written to:\n  ${file}`);
    console.log("[diagnose] navigate to another client to diagnose that one too.\n");
  } catch (err) {
    console.error("[diagnose] failed:", err);
  } finally {
    busy = false;
  }
}

app.whenReady().then(() => {
  session.fromPartition(RAVEN_PARTITION).setUserAgent(CHROME_UA);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "RH DataSheet Maker — diagnostics",
    webPreferences: { partition: RAVEN_PARTITION, contextIsolation: true, nodeIntegration: false },
  });

  const maybeRun = () => {
    const url = win.webContents.getURL();
    let pathname;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return;
    }
    if (!CARE_PLAN_RE.test(pathname)) return;
    console.log(`\n[diagnose] care plan detected: ${url}`);
    console.log("[diagnose] waiting for the page to settle…");
    runDiagnostic(win.webContents);
  };

  win.webContents.on("did-finish-load", maybeRun);
  win.webContents.on("did-navigate-in-page", maybeRun);

  win.loadURL("https://app.ravenhealth.com");

  console.log("\n[diagnose] Raven opened in your saved session.");
  console.log("[diagnose] Navigate to the client's care plan; the report runs automatically.\n");
});

app.on("window-all-closed", () => app.quit());
