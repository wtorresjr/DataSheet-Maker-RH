// ==UserScript==
// @name         RH - Treatment Plan Scraper
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Scrape treatment plan program titles and types into an array, bypassing dynamic React classes
// @match        https://app.ravenhealth.com/clients/*/care-plan
// @grant        none
// ==/UserScript==

// ADDED: 'async' right here before the function
(async function () {
  "use strict";

  const utils = {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    // Dynamic Element Watchers
    async waitForSelector(selector, timeout = 40000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = document.querySelector(selector);
        if (el) return el;
        await utils.sleep(250);
      }
      throw new Error(`Timeout waiting for selector: ${selector}`);
    },
  };

  // Helper function to pause the script so React has time to render new elements
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function scrapePrograms() {
    const programData = [];
    const titleNodes = document.querySelectorAll(
      'div[style*="font-family: Campton-Medium"]',
    );

    for (let titleNode of titleNodes) {
      const typeNode = titleNode.nextElementSibling;

      if (titleNode && typeNode) {
        const titleText = titleNode.innerText.trim();
        const typeText = typeNode.innerText.trim();
        let targets = [];

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

            const activeTargetHeading =
              targetHeadings[targetHeadings.length - 1];

            if (activeTargetHeading) {
              let currentNode = activeTargetHeading.nextElementSibling;

              while (currentNode) {
                let nodeText = currentNode.innerText.trim();
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

            console.log(`Scraped ${targets.length} targets for: ${titleText}`);
            targetButton.parentElement.click();
            await sleep(500);
            console.log(`Clicked target button for: ${titleText}`);
          }
        }

        programData.push({
          title: titleText,
          type: typeText,
          targets: targets,
        });
      }
    }

    const flattenedTableData = [];
    programData.forEach((p) => {
      if (p.targets.length === 0) {
        flattenedTableData.push({
          "Program Title": p.title,
          "Program Type": p.type,
          Target: "No targets found",
        });
      } else {
        p.targets.forEach((target) => {
          flattenedTableData.push({
            "Program Title": p.title,
            "Program Type": p.type,
            Target: target,
          });
        });
      }
    });

    console.table(flattenedTableData);
    return flattenedTableData;
  }

  // --- EXECUTION BLOCK ---
  try {
    // 1. Wait for the primary layout container to appear in the DOM
    console.log("Initializing RH program scrape...");
    await utils.waitForSelector(".css-g5y9jx .r-1i67uc8", 40000);

    // 2. Settle buffer: Gives React a brief moment to unpack child cards/state
    await utils.sleep(1200);
    console.log(
      "Target layout detected and stable. Commencing execution sequence.",
    );

    // Run the scraper after the elements are safely confirmed
    await scrapePrograms();
  } catch (err) {
    console.warn(
      "Main container failed to render within timeout. Executing safety fallback wait...",
      err,
    );
    await utils.sleep(5000);
    // Run scraper anyway as fallback
    //await scrapePrograms();
  }
})(); // Notice the closing notation stays the same
