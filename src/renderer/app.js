// App shell: switches between the embedded Raven browser and the builder,
// tracks which page Raven is on, and runs the extraction.
// builder.js owns everything inside the builder view; this file never reaches
// into it except through window.RHBuilder.
(function () {
  "use strict";

  const CARE_PLAN_RE = /^\/clients\/[^/]+\/care-plan/;

  const el = {
    tabRaven: document.getElementById("tab-raven"),
    tabBuilder: document.getElementById("tab-builder"),
    status: document.getElementById("status"),
    ravenActions: document.getElementById("raven-actions"),
    builderActions: document.getElementById("builder-actions"),
    btnScrape: document.getElementById("btn-scrape"),
    btnNew: document.getElementById("btn-new"),
    ravenView: document.getElementById("raven-view"),
    builderView: document.getElementById("builder-view"),
    raven: document.getElementById("raven"),
  };

  let onCarePlan = false;
  let scraping = false;

  function setStatus(text, kind) {
    el.status.textContent = text || "";
    el.status.className = kind ? `status status-${kind}` : "status";
  }

  // ---- View switching -----------------------------------------------------
  function showView(name) {
    const raven = name === "raven";
    el.ravenView.hidden = !raven;
    el.builderView.hidden = raven;
    el.ravenActions.hidden = !raven;
    el.builderActions.hidden = raven;
    el.tabRaven.classList.toggle("is-active", raven);
    el.tabBuilder.classList.toggle("is-active", !raven);
  }

  el.tabRaven.addEventListener("click", () => showView("raven"));
  el.tabBuilder.addEventListener("click", () => showView("builder"));

  // ---- Raven navigation state --------------------------------------------
  function updateNavState(url) {
    try {
      onCarePlan = CARE_PLAN_RE.test(new URL(url).pathname);
    } catch {
      onCarePlan = false;
    }
    el.btnScrape.disabled = scraping || !onCarePlan;
    el.btnScrape.title = onCarePlan
      ? ""
      : "Open a client's care plan in Raven first.";
  }

  ["did-navigate", "did-navigate-in-page"].forEach((event) =>
    el.raven.addEventListener(event, (e) => updateNavState(e.url)),
  );
  el.raven.addEventListener("dom-ready", () => updateNavState(el.raven.getURL()));

  // ---- Extraction ---------------------------------------------------------
  window.rhAPI.onProgress((progress) => {
    if (progress.phase === "fallback") {
      setStatus("Database unavailable — scraping the page instead…", "warn");
    } else if (progress.total) {
      setStatus(`Scraping ${progress.i}/${progress.total}: ${progress.title}`);
    }
  });

  el.btnScrape.addEventListener("click", async () => {
    scraping = true;
    el.btnScrape.disabled = true;
    setStatus("Reading treatment plan…");

    try {
      const result = await window.rhAPI.scrapePlan(el.raven.getWebContentsId());

      if (!result.ok) {
        setStatus(result.error, "error");
        return;
      }

      // Always say which path ran. When the database read falls back, say why
      // — that reason used to go only to a console the user never sees.
      const count = result.payload.programs.length;
      let text;
      let kind = "ok";
      if (result.method === "database") {
        text = `${count} programs from database.`;
        // Advisory only, and deliberately one-directional: warn when the
        // database returns MORE programs than the page shows, which is the
        // signature of a filter letting retired programs through. Fewer is
        // normal and must not warn — the rendered count also picks up page
        // chrome ("Edit", "Notes", …) that shares the same title font, so it
        // is an inflated upper bound, not an exact expected value.
        if (result.renderedCount && count > result.renderedCount) {
          text += ` Care plan shows only ${result.renderedCount} — check the list.`;
          kind = "warn";
        }
      } else {
        text = `${count} programs from page scrape`;
        text += result.fallbackReason
          ? ` (database unavailable: ${result.fallbackReason}).`
          : ".";
        kind = "warn";
      }
      setStatus(text, kind);
      window.RHBuilder.reset();
      window.RHBuilder.initData(result.payload);
      window.RHBuilder.showParams();
      showView("builder");
    } catch (err) {
      setStatus(`Extraction failed: ${err.message}`, "error");
    } finally {
      scraping = false;
      el.btnScrape.disabled = !onCarePlan;
    }
  });

  // ---- Start over ---------------------------------------------------------
  el.btnNew.addEventListener("click", async () => {
    await window.rhAPI.clearPlan();
    window.RHBuilder.reset();
    setStatus("");
    // The next step is always picking a client, so go where that happens.
    showView("raven");
  });

  updateNavState(el.raven.getAttribute("src") || "");
})();
