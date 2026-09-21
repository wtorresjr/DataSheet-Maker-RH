// Injected into the Raven Health page by src/main/extract.js when the
// database read (db-read.js) can't find a handle.
//
// This is the legacy extension scraper, ported near-verbatim from the old
// src/content/scrape.js. It exists to be the known-working behavior, so the
// fragile selectors are deliberately kept exactly as they were: the
// Campton-Medium inline style for titles, the MaterialCommunityIcons glyph for
// the targets toggle, and the "Targets" / "Prompt List" text sentinels.
//
// Resolves to { ok, clientId, scrapedAt, programs } — the same shape as
// db-read.js.
(async () => {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForSelector(selector, timeout = 40000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(250);
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  // The scraper can't call back into the main process, so progress goes out as
  // a prefixed console line that extract.js listens for.
  function reportProgress(i, total, title) {
    console.log("RHDS_PROGRESS " + JSON.stringify({ i, total, title }));
  }

  async function scrapePrograms(onProgress) {
    const programData = [];
    const titleNodes = document.querySelectorAll(
      'div[style*="font-family: Campton-Medium"]',
    );

    let index = 0;
    for (const titleNode of titleNodes) {
      const typeNode = titleNode.nextElementSibling;
      if (!titleNode || !typeNode) continue;

      const titleText = titleNode.innerText.trim();
      const typeText = typeNode.innerText.trim();
      const targets = [];

      index += 1;
      if (onProgress) onProgress(index, titleNodes.length, titleText);

      if (typeText.toLowerCase() === "skill | trial by trial") {
        let currentParent = titleNode;
        let targetButton = null;

        for (let i = 0; i < 6; i++) {
          currentParent = currentParent.parentElement;
          if (!currentParent) break;

          const icons = Array.from(
            currentParent.querySelectorAll(
              'div[style*="font-family: MaterialCommunityIcons"]',
            ),
          );
          targetButton = icons.find((icon) => icon.innerText.trim() === "\u{F0328}");
          if (targetButton) break;
        }

        if (targetButton) {
          targetButton.parentElement.click();
          await sleep(1500);

          const targetHeadings = Array.from(
            document.querySelectorAll('div[dir="auto"]'),
          ).filter((div) => div.innerText.trim() === "Targets");

          const activeTargetHeading = targetHeadings[targetHeadings.length - 1];

          if (activeTargetHeading) {
            let currentNode = activeTargetHeading.nextElementSibling;
            while (currentNode) {
              const nodeText = currentNode.innerText.trim();
              if (nodeText === "Prompt List") break;
              if (
                nodeText !== "Individual data points to be collected on" &&
                nodeText !== ""
              ) {
                targets.push(nodeText);
              }
              currentNode = currentNode.nextElementSibling;
            }
          }

          targetButton.parentElement.click();
          await sleep(500);
        }
      }

      programData.push({ title: titleText, type: typeText, targets });
    }

    return programData;
  }

  function getClientId() {
    const m = location.pathname.match(/\/clients\/([^/]+)\/care-plan/);
    return m ? m[1] : "unknown";
  }

  try {
    await waitForSelector('div[style*="font-family: Campton-Medium"]', 40000);
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  try {
    const programs = await scrapePrograms(reportProgress);
    if (!programs.length) {
      return {
        ok: false,
        reason: "No programs found on this page. Is the care plan loaded?",
      };
    }
    return {
      ok: true,
      clientId: getClientId(),
      scrapedAt: new Date().toISOString(),
      programs,
    };
  } catch (err) {
    return { ok: false, reason: `scrape failed: ${err && err.message}` };
  }
})();
