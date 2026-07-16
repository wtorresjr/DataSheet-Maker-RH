// RH DataSheet Maker — content script.
// Injects a "Create Data Sheet" button on the Raven Health care-plan page,
// scrapes program/target data (ported from the TamperMonkey userscript), stores
// it in chrome.storage.local, and opens the builder page.
(function () {
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

  // ---- Scrape (keeps structured {title, type, targets[]} shape) ----------
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
          targetButton = icons.find((icon) => icon.innerText.trim() === "󰌨");
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

  // ---- Client id from URL: /clients/<id>/care-plan ------------------------
  function getClientId() {
    const m = location.pathname.match(/\/clients\/([^/]+)\/care-plan/);
    return m ? m[1] : "unknown";
  }

  // ---- UI: floating button + status overlay -------------------------------
  function makeButton() {
    if (document.getElementById("rh-ds-btn")) return;

    const btn = document.createElement("button");
    btn.id = "rh-ds-btn";
    btn.textContent = "Create Data Sheet";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "24px",
      right: "24px",
      zIndex: "2147483647",
      padding: "12px 18px",
      fontSize: "14px",
      fontWeight: "600",
      fontFamily: "system-ui, sans-serif",
      color: "#fff",
      background: "#2563eb",
      border: "none",
      borderRadius: "8px",
      boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
      cursor: "pointer",
    });

    const status = document.createElement("div");
    status.id = "rh-ds-status";
    Object.assign(status.style, {
      position: "fixed",
      bottom: "72px",
      right: "24px",
      zIndex: "2147483647",
      maxWidth: "320px",
      padding: "10px 14px",
      fontSize: "13px",
      fontFamily: "system-ui, sans-serif",
      color: "#111",
      background: "#fff",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
      display: "none",
    });

    const setStatus = (text) => {
      status.style.display = "block";
      status.textContent = text;
    };

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.style.cursor = "wait";
      setStatus("Starting scrape…");

      try {
        const programs = await scrapePrograms((i, total, title) => {
          setStatus(`Scraping ${i}/${total}: ${title}`);
        });

        if (!programs.length) {
          setStatus("No programs found on this page. Is the care plan loaded?");
          return;
        }

        setStatus(`Scraped ${programs.length} programs. Opening builder…`);

        const payload = {
          clientId: getClientId(),
          scrapedAt: new Date().toISOString(),
          programs,
        };

        await chrome.storage.local.set({ rhDataSheet: payload });
        chrome.runtime.sendMessage({ type: "OPEN_BUILDER" });
      } catch (err) {
        console.error("RH DataSheet scrape failed:", err);
        setStatus("Scrape failed — see console for details.");
      } finally {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
      }
    });

    document.body.appendChild(status);
    document.body.appendChild(btn);
  }

  (async function init() {
    try {
      await waitForSelector('div[style*="font-family: Campton-Medium"]', 40000);
    } catch (e) {
      // Show the button anyway; the user can retry once the page settles.
      console.warn("RH DataSheet: program titles not detected yet.", e);
    }
    makeButton();
  })();
})();
