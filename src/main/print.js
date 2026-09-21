// Print + PDF for the builder's sheet view. The Electron win over the
// extension is here: printToPDF writes to a real path instead of making the
// user remember to pick "Save as PDF" in the browser's print dialog.
const fs = require("node:fs/promises");
const { dialog } = require("electron");

// printToPDF is driven by these options rather than print.css's
// `@page { size: landscape; margin: 0.3in }` — the two must agree.
const PAGE_OPTIONS = {
  landscape: true,
  printBackground: true, // the sheet's cells rely on painted borders
  pageSize: "Letter",
  margins: { marginType: "custom", top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 },
};

const slug = (s) => String(s || "unknown").replace(/[^A-Za-z0-9_-]+/g, "-");

function defaultFileName(clientId) {
  const date = new Date().toISOString().slice(0, 10);
  return `RH-DataSheet-${slug(clientId)}-${date}.pdf`;
}

function printSheet(webContents) {
  return new Promise((resolve, reject) => {
    webContents.print(
      { landscape: true, printBackground: true },
      (success, failureReason) => {
        // The user cancelling the dialog is a non-error "not printed".
        if (!success && failureReason && failureReason !== "cancelled") {
          reject(new Error(failureReason));
        } else {
          resolve({ printed: success });
        }
      },
    );
  });
}

async function savePdf(window, clientId) {
  const data = await window.webContents.printToPDF(PAGE_OPTIONS);

  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: "Save Data Sheet",
    defaultPath: defaultFileName(clientId),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return { path: null };

  await fs.writeFile(filePath, data);
  return { path: filePath };
}

module.exports = { printSheet, savePdf };
