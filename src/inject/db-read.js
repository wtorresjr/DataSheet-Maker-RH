// Injected into the Raven Health page (main world) by src/main/extract.js.
// Reads the treatment plan straight out of Raven's local data store instead of
// scraping the DOM. Raven runs WatermelonDB on a LokiJS adapter; `programs`
// and `targets` are reference tables that sync in full, so the whole care plan
// is already in memory — no modal clicking, no fixed sleeps.
//
// Resolves to { ok: true, clientId, scrapedAt, programs: [{title, type, targets}] }
// or { ok: false, reason } — never throws, so the caller can log why it fell
// back to the DOM scraper.
(async () => {
  "use strict";

  // The builder matches on these display strings (src/renderer/builder/builder.js).
  const TYPE_LABELS = {
    "skill|trial_by_trial": "Skill | Trial By Trial",
    "skill|task_analysis": "Skill | Task Analysis",
    "behavior|frequency": "Behavior | Frequency",
    "behavior|rate": "Behavior | Rate",
    "behavior|interval": "Behavior | Interval",
    "behavior|duration": "Behavior | Duration",
  };

  const titleCase = (s) =>
    String(s || "")
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

  function typeLabel(type, method) {
    const key = `${String(type || "").toLowerCase()}|${String(method || "").toLowerCase()}`;
    // Unmapped combinations pass through readably rather than being dropped;
    // the builder has an unknown-type fallback branch for exactly this.
    return TYPE_LABELS[key] || `${titleCase(type)} | ${titleCase(method)}`.trim();
  }

  function getClientId() {
    const m = location.pathname.match(/\/clients\/([^/]+)/);
    return m ? m[1] : null;
  }

  // ---- Find any WatermelonDB record in the live React tree ----------------
  // Search by *shape* (the record carries `._raw`), never by prop name: Raven's
  // components use wildly inconsistent names for the same underlying table.
  const isRecord = (v) =>
    v && typeof v === "object" && v._raw && v.collection && v.collection.database;

  function recordIn(value, depth = 0) {
    if (isRecord(value)) return value;
    if (depth > 0 || !Array.isArray(value)) return null;
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

      // Components that fetch their own data via a hook never appear in a
      // props-only scan. Hooks are a linked list on memoizedState.
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
    const elements = document.querySelectorAll("*");
    for (const el of elements) {
      const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (!fiberKey) continue;
      const hit = recordFromFiber(el[fiberKey]);
      if (hit) return hit;
    }
    return null;
  }

  // ---- Climb from a record to the raw Loki store --------------------------
  // Identify these objects structurally — adapter class names are minified to
  // single letters, so never match on constructor.name.
  function findLoki(database) {
    const adapter = database.adapter;
    if (!adapter) return null;
    const candidates = [adapter, adapter.underlyingAdapter];
    for (const a of candidates) {
      if (!a) continue;
      const loki = a.loki || (a._driver && a._driver.loki) || (a.driver && a.driver.loki);
      if (loki && typeof loki.getCollection === "function") return loki;
    }
    return null;
  }

  try {
    const clientId = getClientId();
    if (!clientId) return { ok: false, reason: "not on a /clients/{id} page" };

    const record = findRecord();
    if (!record) return { ok: false, reason: "no WatermelonDB record in the React tree" };

    const loki = findLoki(record.collection.database);
    if (!loki) return { ok: false, reason: "could not reach the LokiJS store" };

    // Read Loki's `.data` arrays directly. `collection.query().fetch()` would
    // materialise ORM instances over the whole store — prohibitively slow.
    const rows = (table) => {
      const collection = loki.getCollection(table);
      return collection ? collection.data : null;
    };

    // Soft deletes are application-level: WatermelonDB's `_status` still reads
    // "synced" on deleted rows, so the ORM does not hide them. Filter manually.
    const live = (list) => (list || []).filter((r) => !r.deleted_at);

    const allPrograms = rows("programs");
    if (!allPrograms) return { ok: false, reason: "no `programs` collection in the store" };

    // `programs` holds each program twice — once assigned to the patient, once
    // as the org library template with an empty patient_id. Without this filter
    // every program appears on the sheet twice.
    //
    // Raven marks a program `state: "archived"` once the client has mastered it
    // and staff stop recording data for it. Those rows stay in the store
    // forever, so without this the sheet fills with retired programs (82 rows
    // vs 56 live ones on one real client). This is the third filter of its
    // kind here, alongside soft-deletes and org templates.
    //
    // Excluding "archived" rather than keeping only "active" is deliberate: an
    // unanticipated state value leaves a program ON the sheet, where it is
    // visible and can be unchecked in the parameters step. The opposite
    // mistake silently drops a program, and a missing row on a data sheet
    // means data never gets collected for it.
    const archived = (p) => p.state === "archived";

    const programs = live(allPrograms).filter(
      (p) => p.patient_id === clientId && !archived(p),
    );
    if (!programs.length) {
      return { ok: false, reason: `no programs for patient ${clientId} in the local store` };
    }

    // Behavior programs have no `targets` rows at all.
    const targetsByProgram = new Map();
    for (const t of live(rows("targets"))) {
      if (!t.enabled) continue;
      if (!targetsByProgram.has(t.program_id)) targetsByProgram.set(t.program_id, []);
      targetsByProgram.get(t.program_id).push(t);
    }

    // Loki's row order is an implementation detail; the DOM scraper inherited
    // the visual care-plan order, so sort deliberately to keep card order
    // stable across runs.
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

    const result = programs
      .map((p) => ({
        title: (p.name || "").trim(),
        type: typeLabel(p.type, p.method),
        targets: (targetsByProgram.get(p.id) || [])
          .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
          .map((t) => (t.name || "").trim())
          .filter(Boolean),
      }))
      .sort((a, b) => collator.compare(a.title, b.title));

    return {
      ok: true,
      clientId,
      scrapedAt: new Date().toISOString(),
      programs: result,
    };
  } catch (err) {
    return { ok: false, reason: `database read threw: ${err && err.message}` };
  }
})();
