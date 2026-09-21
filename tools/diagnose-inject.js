// Diagnostic injected into a live Raven care-plan page by tools/diagnose.js.
// Read-only: it inspects the local WatermelonDB/LokiJS store and the rendered
// DOM, and reports why the database read returns more programs than the care
// plan actually shows. It writes nothing and clicks nothing.
(async () => {
  "use strict";

  // ---- Same fiber/Loki traversal as src/inject/db-read.js -----------------
  const isRecord = (v) =>
    v && typeof v === "object" && v._raw && v.collection && v.collection.database;

  function recordIn(value) {
    if (isRecord(value)) return value;
    if (!Array.isArray(value)) return null;
    for (const item of value) if (isRecord(item)) return item;
    return null;
  }

  function recordFromFiber(startFiber) {
    let fiber = startFiber;
    for (let i = 0; fiber && i < 150; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props && typeof props === "object") {
        for (const key of Object.keys(props)) {
          const hit = recordIn(props[key]);
          if (hit) return hit;
        }
      }
      let hook = fiber.memoizedState;
      for (let h = 0; hook && typeof hook === "object" && h < 30; h++) {
        const hit = recordIn(hook.memoizedState);
        if (hit) return hit;
        hook = hook.next;
      }
    }
    return null;
  }

  function findRecord() {
    for (const el of document.querySelectorAll("*")) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (!key) continue;
      const hit = recordFromFiber(el[key]);
      if (hit) return hit;
    }
    return null;
  }

  function findLoki(database) {
    const adapter = database.adapter;
    if (!adapter) return null;
    for (const a of [adapter, adapter.underlyingAdapter]) {
      if (!a) continue;
      const loki = a.loki || (a._driver && a._driver.loki) || (a.driver && a.driver.loki);
      if (loki && typeof loki.getCollection === "function") return loki;
    }
    return null;
  }

  try {
    const m = location.pathname.match(/\/clients\/([^/]+)/);
    const clientId = m ? m[1] : null;
    if (!clientId) return { ok: false, reason: "not on a /clients/{id} page" };

    const record = findRecord();
    if (!record) return { ok: false, reason: "no WatermelonDB record in the React tree" };
    const database = record.collection.database;
    const loki = findLoki(database);
    if (!loki) return { ok: false, reason: "could not reach the LokiJS store" };

    const rows = (t) => {
      const c = loki.getCollection(t);
      return c ? c.data : [];
    };
    const live = (list) => list.filter((r) => !r.deleted_at);

    // ---- 1. Complete column map for `programs` (and the table list) -------
    const schema = database.schema && database.schema.tables;
    const programSchema = schema && schema.programs;
    const schemaColumns = programSchema
      ? Object.keys(programSchema.columns || programSchema)
      : null;

    const allPrograms = rows("programs");
    // Union of keys actually present on rows — the schema can lag reality.
    const observedKeys = [...new Set(allPrograms.flatMap((p) => Object.keys(p)))].sort();

    // ---- 2. Counts at each filter stage -----------------------------------
    const livePrograms = live(allPrograms);
    const mine = livePrograms.filter((p) => p.patient_id === clientId);

    // ---- 3. Distinct patient_id values ------------------------------------
    const byPatient = {};
    for (const p of livePrograms) {
      const k = p.patient_id === "" ? "(empty — org template)" : p.patient_id;
      byPatient[k] = (byPatient[k] || 0) + 1;
    }
    const patientCounts = Object.entries(byPatient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([id, n]) => ({ patient_id: id, count: n, isCurrent: id === clientId }));

    // ---- 4/5. What the page actually renders, and the diff ----------------
    // The card list may be virtualized, so a single snapshot would report
    // offscreen programs as "missing from the page" — a false positive that
    // would send the whole diagnosis the wrong way. Scroll to the bottom,
    // accumulating titles, until the page stops growing.
    const norm = (s) => (s || "").trim().toLowerCase();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const titleNodes = () => [...document.querySelectorAll(
      'div[style*="font-family: Campton-Medium"]',
    )].map((d) => d.innerText.trim()).filter(Boolean);

    const collected = new Map(); // normalised -> original casing
    const addVisible = () => titleNodes().forEach((t) => collected.set(norm(t), t));

    const firstPassCount = titleNodes().length;
    addVisible();
    let lastY = -1;
    for (let i = 0; i < 60; i++) {
      window.scrollBy(0, window.innerHeight * 0.9);
      await sleep(250);
      addVisible();
      const y = Math.round(window.scrollY);
      if (y === lastY) break; // stopped moving: bottom reached
      lastY = y;
    }
    window.scrollTo(0, 0);
    await sleep(250);
    addVisible();

    const renderedTitles = [...collected.values()];
    const wasVirtualized = renderedTitles.length > firstPassCount;
    const renderedSet = new Set(collected.keys());

    const onPage = mine.filter((p) => renderedSet.has(norm(p.name)));
    const notOnPage = mine.filter((p) => !renderedSet.has(norm(p.name)));
    const dbSet = new Set(mine.map((p) => norm(p.name)));
    const onPageNotInDb = renderedTitles.filter((t) => !dbSet.has(norm(t)));

    // Strip noisy/large fields so the dump stays readable.
    const SKIP = new Set(["objective", "instructions", "description", "$loki", "meta"]);
    const slim = (p) => {
      const out = {};
      for (const k of Object.keys(p).sort()) if (!SKIP.has(k)) out[k] = p[k];
      return out;
    };

    // Value distribution per field, over this patient's rows. Fields with few
    // distinct values are the candidate status flags; high-cardinality ones
    // (ids, timestamps) are noise.
    const LOW_CARDINALITY_MAX = 12;
    const distributions = {};
    for (const key of observedKeys) {
      if (SKIP.has(key) || key === "name" || key === "id") continue;
      const counts = {};
      for (const p of mine) {
        const v = JSON.stringify(p[key] ?? null);
        counts[v] = (counts[v] || 0) + 1;
      }
      const distinct = Object.keys(counts).length;
      if (distinct <= LOW_CARDINALITY_MAX) {
        distributions[key] = Object.fromEntries(
          Object.entries(counts).sort((a, b) => b[1] - a[1]),
        );
      }
    }

    // For each field, which values appear on rendered vs non-rendered rows?
    // A field whose value sets do not overlap is a candidate discriminator.
    //
    // Only consider low-cardinality fields. Timestamps and ids are unique per
    // row, so their value sets *never* overlap and they look like perfect
    // discriminators while meaning nothing — `updated_at` did exactly that on
    // the first run of this diagnostic.
    const discriminators = [];
    for (const key of Object.keys(distributions)) {
      const vals = (list) => new Set(list.map((p) => JSON.stringify(p[key] ?? null)));
      const a = vals(onPage);
      const b = vals(notOnPage);
      if (!a.size || !b.size) continue;
      const overlap = [...a].filter((v) => b.has(v));
      if (overlap.length === 0) {
        discriminators.push({
          field: key,
          onPageValues: [...a].slice(0, 8),
          notOnPageValues: [...b].slice(0, 8),
        });
      }
    }

    // Cross-tab the leading candidate against what the page renders. Name
    // matching is imperfect — an archived program that shares a name with an
    // active one lands in the "on page" bucket — so a field can be the real
    // answer without showing a clean split above.
    const crossTab = (key) => {
      const out = {};
      for (const [label, list] of [["onPage", onPage], ["notOnPage", notOnPage]]) {
        for (const p of list) {
          const v = String(p[key] ?? "");
          out[v] = out[v] || { onPage: 0, notOnPage: 0 };
          out[v][label] += 1;
        }
      }
      return out;
    };

    // What the app's filter would actually yield, so a re-run verifies the fix.
    const notArchived = mine.filter((p) => p.state !== "archived");
    const filterPreview = {
      currentFilter_patientIdOnly: mine.length,
      withStateNotArchived: notArchived.length,
      withStateActiveOnly: mine.filter((p) => p.state === "active").length,
      excludedAsArchived: mine.length - notArchived.length,
      // Anything neither active nor archived would be silently dropped by an
      // "active only" filter — this is why the app excludes archived instead.
      otherStates: [...new Set(
        mine.filter((p) => p.state !== "active" && p.state !== "archived")
            .map((p) => String(p.state ?? "")),
      )],
    };

    return {
      ok: true,
      clientId,
      url: location.href,
      wasVirtualized,
      tables: schema ? Object.keys(schema).sort() : null,
      schemaColumns,
      observedKeys,
      counts: {
        programsTotal: allPrograms.length,
        afterDeletedAt: livePrograms.length,
        afterPatientId: mine.length,
        renderedOnPage: renderedTitles.length,
        renderedBeforeScrolling: firstPassCount,
        matchedDbAndPage: onPage.length,
        inDbNotOnPage: notOnPage.length,
        onPageNotInDb: onPageNotInDb.length,
      },
      patientCounts,
      // THE ANSWER, if any single field cleanly separates the two groups.
      discriminators,
      distributions,
      stateCrossTab: crossTab("state"),
      phaseCrossTab: crossTab("phase"),
      filterPreview,
      onPageNotInDb,
      samples: {
        onPage: onPage.slice(0, 3).map(slim),
        notOnPage: notOnPage.slice(0, 6).map(slim),
      },
      notOnPageTitles: notOnPage.map((p) => p.name),
      onPageTitles: onPage.map((p) => p.name),
    };
  } catch (err) {
    return { ok: false, reason: `diagnostic threw: ${err && err.message}` };
  }
})();
