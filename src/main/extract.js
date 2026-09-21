// Plan extraction: read Raven's local WatermelonDB store first, fall back to
// the legacy DOM scraper. Both paths are plain .js files under src/inject/,
// read off disk and evaluated in the Raven page. They are kept as real files
// (not template strings) so they stay lintable and diffable.
const fs = require("node:fs");
const path = require("node:path");

const INJECT_DIR = path.join(__dirname, "..", "inject");
const DB_TIMEOUT_MS = 30_000;
const DOM_TIMEOUT_MS = 180_000;
const PROGRESS_PREFIX = "RHDS_PROGRESS ";

const readInject = (name) =>
  fs.readFileSync(path.join(INJECT_DIR, name), "utf8");

// Nothing should be able to hang silently. Note that a timed-out call returns
// nothing at all — partial results included — so callers must not expect one.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The DOM scraper cannot call back into the main process, so it reports
// progress by logging a prefixed line; we listen for it on the webContents.
function pipeProgress(webContents, onProgress) {
  if (!onProgress) return () => {};

  const handler = (...args) => {
    // Electron >= 36 passes a single details object; older versions passed
    // (event, level, message, line, sourceId).
    const details = args[0];
    const message =
      typeof details === "object" && typeof details.message === "string"
        ? details.message
        : typeof args[2] === "string"
          ? args[2]
          : "";
    if (!message.startsWith(PROGRESS_PREFIX)) return;
    try {
      onProgress(JSON.parse(message.slice(PROGRESS_PREFIX.length)));
    } catch {
      /* malformed progress line — not worth failing the scrape over */
    }
  };

  webContents.on("console-message", handler);
  return () => webContents.off("console-message", handler);
}

// How many program cards the care plan is currently showing. Cheap: the title
// divs exist without opening any modal. Used only to report alongside the
// database count, never to change what is extracted.
const RENDERED_COUNT_JS =
  `document.querySelectorAll('div[style*="font-family: Campton-Medium"]').length`;

async function renderedProgramCount(webContents) {
  try {
    return await withTimeout(
      webContents.executeJavaScript(RENDERED_COUNT_JS, false),
      5000,
      "page program count",
    );
  } catch {
    return null; // advisory only — never fail an extraction over it
  }
}

const isUsable = (payload) =>
  payload &&
  payload.ok !== false &&
  Array.isArray(payload.programs) &&
  payload.programs.length > 0;

/**
 * @returns {Promise<{payload: object, method: "database"|"dom"}>}
 */
async function extractPlan(webContents, onProgress) {
  let dbReason = "returned no programs";

  try {
    const payload = await withTimeout(
      webContents.executeJavaScript(readInject("db-read.js"), false),
      DB_TIMEOUT_MS,
      "database read",
    );
    if (isUsable(payload)) {
      return {
        payload,
        method: "database",
        renderedCount: await renderedProgramCount(webContents),
      };
    }
    dbReason = (payload && payload.reason) || dbReason;
  } catch (err) {
    dbReason = err.message;
  }

  console.warn(`Database read unavailable (${dbReason}) — falling back to the DOM scraper.`);
  if (onProgress) onProgress({ phase: "fallback", reason: dbReason });

  const stopProgress = pipeProgress(webContents, onProgress);
  try {
    // userGesture: true — this path clicks modals open and closed.
    const payload = await withTimeout(
      webContents.executeJavaScript(readInject("dom-scrape.js"), true),
      DOM_TIMEOUT_MS,
      "DOM scrape",
    );
    if (isUsable(payload)) return { payload, method: "dom", fallbackReason: dbReason };
    throw new Error(
      (payload && payload.reason) ||
        "No programs found on this page. Is the care plan fully loaded?",
    );
  } finally {
    stopProgress();
  }
}

module.exports = { extractPlan };
