// Persistence for the last scraped plan. Replaces chrome.storage.local, which
// held exactly one key ("rhDataSheet") with the same payload shape.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const planPath = () => path.join(app.getPath("userData"), "last-plan.json");

// { clientId, scrapedAt, programs: [{ title, type, targets: string[] }] }
function loadPlan() {
  try {
    const raw = fs.readFileSync(planPath(), "utf8");
    const payload = JSON.parse(raw);
    if (payload && Array.isArray(payload.programs)) return payload;
  } catch (err) {
    // Missing file is the normal first-run case; a corrupt one is not worth
    // failing over either — the builder falls back to its empty state.
    if (err.code !== "ENOENT") console.warn("last-plan.json unreadable:", err);
  }
  return null;
}

function savePlan(payload) {
  try {
    fs.writeFileSync(planPath(), JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.warn("could not persist last-plan.json:", err);
  }
}

// Forget the last plan entirely, so the app starts empty on the next launch.
function clearPlan() {
  try {
    fs.unlinkSync(planPath());
  } catch (err) {
    // Already gone is success, not failure.
    if (err.code !== "ENOENT") console.warn("could not clear last-plan.json:", err);
  }
}

module.exports = { loadPlan, savePlan, clearPlan, planPath };
