// RH DataSheet Maker — builder page logic.
// Two steps: (1) Parameters, (2) Preview. Data comes from chrome.storage.local
// (written by the content script) or the dev "Load sample data" button.
(function () {
  "use strict";

  // ---- Program type constants --------------------------------------------
  const TYPE = {
    FREQUENCY: "behavior | frequency",
    RATE: "behavior | rate",
    INTERVAL: "behavior | interval",
    DURATION: "behavior | duration",
    TRIAL: "skill | trial by trial",
    TASK: "skill | task analysis",
  };

  const DEFAULTS = { intervals: 5, slots: 8, minTrials: 10, steps: 10 };

  const norm = (t) => (t || "").trim().toLowerCase();
  const isBehavior = (t) => norm(t).startsWith("behavior");

  // ---- State --------------------------------------------------------------
  const state = {
    data: null, // { clientId, scrapedAt, programs: [...] }
  };

  const el = {
    toolbar: document.getElementById("toolbar"),
    meta: document.getElementById("meta"),
    btnBuild: document.getElementById("btn-build"),
    btnBack: document.getElementById("btn-back"),
    btnPrint: document.getElementById("btn-print"),
    btnPdf: document.getElementById("btn-pdf"),
    btnSample: document.getElementById("btn-sample"),
    paramsView: document.getElementById("params-view"),
    paramsEmpty: document.getElementById("params-empty"),
    paramsBody: document.getElementById("params-body"),
    previewView: document.getElementById("preview-view"),
    sheet: document.getElementById("sheet"),
  };

  // ---- Load ---------------------------------------------------------------
  async function load() {
    let payload = null;
    try {
      const res = await chrome.storage.local.get("rhDataSheet");
      payload = res && res.rhDataSheet;
    } catch (e) {
      // Not in an extension context (or storage unavailable) — fall through.
      console.warn("storage.local unavailable:", e);
    }
    if (payload && Array.isArray(payload.programs) && payload.programs.length) {
      initData(payload);
    } else {
      el.paramsEmpty.hidden = false;
    }
  }

  function initData(payload) {
    state.data = payload;
    // Attach default params to each program based on type.
    payload.programs.forEach((p) => {
      p._params = defaultParamsFor(p.type);
      p._enabled = true; // whole program plotted on the sheet
      p._targetsEnabled = (p.targets || []).map(() => true); // per-target
    });
    el.paramsEmpty.hidden = true;
    el.meta.textContent = `Client ${payload.clientId} · ${payload.programs.length} programs`;
    renderParams();
  }

  function defaultParamsFor(type) {
    switch (norm(type)) {
      case TYPE.INTERVAL:
        return { intervals: DEFAULTS.intervals };
      case TYPE.DURATION:
        return { slots: DEFAULTS.slots };
      case TYPE.TRIAL:
        return { minTrials: DEFAULTS.minTrials };
      case TYPE.TASK:
        return { steps: DEFAULTS.steps };
      default:
        return {}; // frequency / rate: no params
    }
  }

  // ---- Parameters step ----------------------------------------------------
  // Behaviors are grouped by type so like parameters are set together.
  const BEHAVIOR_ORDER = [
    { key: TYPE.FREQUENCY, label: "Frequency" },
    { key: TYPE.RATE, label: "Rate" },
    { key: TYPE.INTERVAL, label: "Interval" },
    { key: TYPE.DURATION, label: "Duration" },
  ];

  function renderParams() {
    el.paramsBody.innerHTML = "";
    const programs = state.data.programs;

    const behaviors = programs.filter((p) => isBehavior(p.type));
    const skills = programs.filter((p) => !isBehavior(p.type));

    el.paramsBody.appendChild(behaviorSection(behaviors, programs));
    el.paramsBody.appendChild(skillSection(skills, programs));
  }

  function sectionShell(heading, count) {
    const sec = document.createElement("section");
    sec.className = "param-section";
    const h = document.createElement("h2");
    h.textContent = `${heading} (${count})`;
    sec.appendChild(h);
    return sec;
  }

  // Behaviors: one subgroup per type (Frequency, Rate, Interval, Duration).
  function behaviorSection(list, allPrograms) {
    const sec = sectionShell("Behaviors", list.length);
    BEHAVIOR_ORDER.forEach((group) => {
      const items = list.filter((p) => norm(p.type) === group.key);
      if (!items.length) return;
      const sub = document.createElement("h3");
      sub.className = "param-subhead";
      sub.textContent = `${group.label} (${items.length})`;
      sec.appendChild(sub);
      items.forEach((p) =>
        sec.appendChild(paramRow(p, allPrograms.indexOf(p), false)),
      );
    });
    return sec;
  }

  // Skills: each program (and its targets) can be excluded from the sheet.
  function skillSection(list, allPrograms) {
    const sec = sectionShell("Skills", list.length);
    const hint = document.createElement("p");
    hint.className = "param-hint";
    hint.textContent =
      "Uncheck a program to leave it off the sheet, or uncheck individual targets.";
    sec.appendChild(hint);
    list.forEach((p) =>
      sec.appendChild(paramRow(p, allPrograms.indexOf(p), true)),
    );
    return sec;
  }

  function paramRow(program, idx, removable) {
    const row = document.createElement("div");
    row.className = "param-row";
    if (removable && !program._enabled) row.classList.add("excluded");

    const info = document.createElement("div");
    info.className = "param-info";

    // Title line — with an include toggle for removable (skill) rows.
    const titleLine = document.createElement("div");
    titleLine.className = "param-title-line";
    if (removable) {
      const inc = document.createElement("input");
      inc.type = "checkbox";
      inc.className = "include-toggle";
      inc.checked = program._enabled;
      inc.title = "Include this program on the data sheet";
      inc.addEventListener("change", () => {
        program._enabled = inc.checked;
        row.classList.toggle("excluded", !program._enabled);
      });
      titleLine.appendChild(inc);
    }
    const title = document.createElement("span");
    title.className = "param-title";
    title.textContent = program.title;
    titleLine.appendChild(title);
    info.appendChild(titleLine);

    const type = document.createElement("div");
    type.className = "param-type";
    type.textContent = program.type;
    info.appendChild(type);
    row.appendChild(info);

    const control = document.createElement("div");
    control.className = "param-control";
    const t = norm(program.type);

    if (t === TYPE.INTERVAL) {
      control.appendChild(numberField("Number of intervals", program._params, "intervals", idx));
    } else if (t === TYPE.DURATION) {
      control.appendChild(numberField("Number of slots", program._params, "slots", idx));
    } else if (t === TYPE.TRIAL) {
      control.appendChild(numberField("Min. number of trials", program._params, "minTrials", idx));
    } else if (t === TYPE.TASK) {
      control.appendChild(numberField("Number of steps", program._params, "steps", idx));
    } else {
      const note = document.createElement("span");
      note.className = "param-note";
      note.textContent = "Tally box — no parameters";
      control.appendChild(note);
    }
    row.appendChild(control);

    // Target list (trial-by-trial) — interactive checkboxes when removable.
    if (t === TYPE.TRIAL && program.targets.length) {
      const tl = document.createElement("ul");
      tl.className = "target-list" + (removable ? " target-list-editable" : "");
      program.targets.forEach((tg, i) => {
        const li = document.createElement("li");
        if (removable) {
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = program._targetsEnabled[i];
          cb.addEventListener("change", () => {
            program._targetsEnabled[i] = cb.checked;
            li.classList.toggle("excluded", !cb.checked);
          });
          const span = document.createElement("span");
          span.textContent = tg;
          li.appendChild(cb);
          li.appendChild(span);
          if (!program._targetsEnabled[i]) li.classList.add("excluded");
        } else {
          li.textContent = tg;
        }
        tl.appendChild(li);
      });
      info.appendChild(tl);
    }

    return row;
  }

  function numberField(label, paramsObj, key, idx) {
    const wrap = document.createElement("label");
    wrap.className = "num-field";
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "60";
    input.value = paramsObj[key];
    input.id = `param-${idx}-${key}`;
    input.addEventListener("input", () => {
      const v = parseInt(input.value, 10);
      paramsObj[key] = Number.isFinite(v) && v > 0 ? v : DEFAULTS[key] || 1;
    });
    wrap.appendChild(input);
    return wrap;
  }

  // ---- Preview step: build the sheet --------------------------------------
  function buildSheet() {
    el.sheet.innerHTML = "";
    const programs = state.data.programs;
    // Group behavior cards by type (Frequency, Rate, Interval, Duration) so
    // like widgets sit together in the band; keep scrape order within a type.
    const typeRank = (t) => {
      const i = BEHAVIOR_ORDER.findIndex((g) => g.key === norm(t));
      return i === -1 ? BEHAVIOR_ORDER.length : i;
    };
    const behaviors = programs
      .filter((p) => isBehavior(p.type))
      .sort((a, b) => typeRank(a.type) - typeRank(b.type));
    // Skills the user excluded are left off the sheet entirely.
    const skills = programs.filter((p) => !isBehavior(p.type) && p._enabled);

    // Header line with date field
    const head = document.createElement("div");
    head.className = "sheet-head";
    head.innerHTML =
      `<span class="date-field">Date: <span class="date-line"></span></span>` +
      `<span class="client-field">Client: ${escapeHtml(state.data.clientId)}</span>`;
    el.sheet.appendChild(head);

    // Behaviors band (full width, top). Split into per-type sub-bands:
    //  - Frequency + Rate: half-width tally boxes in a uniform-height flex row.
    //  - Interval / Duration: masonry multicolumns so short cards stack up
    //    under tall ones (e.g. a many-interval card) and fill the dead space.
    if (behaviors.length) {
      const band = document.createElement("section");
      band.className = "behaviors-band";

      const inType = (p, ...types) => types.includes(norm(p.type));
      const subBands = [
        { cls: "bhv-tally", items: behaviors.filter((p) => inType(p, TYPE.FREQUENCY, TYPE.RATE)) },
        { cls: "bhv-interval", items: behaviors.filter((p) => inType(p, TYPE.INTERVAL)) },
        { cls: "bhv-duration", items: behaviors.filter((p) => inType(p, TYPE.DURATION)) },
      ];
      subBands.forEach(({ cls, items }) => {
        if (!items.length) return;
        const sub = document.createElement("div");
        sub.className = `bhv-sub ${cls}`;
        items.forEach((p) => sub.appendChild(behaviorCard(p)));
        band.appendChild(sub);
      });
      el.sheet.appendChild(band);
    }

    // Skills region (multicolumn)
    if (skills.length) {
      const region = document.createElement("section");
      region.className = "skills-region";
      skills.forEach((p) => region.appendChild(skillCard(p)));
      el.sheet.appendChild(region);
    }
  }

  function cardShell(program, extraClass) {
    const card = document.createElement("article");
    card.className = `card ${extraClass}`;
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = program.title;
    card.appendChild(title);
    return card;
  }

  function behaviorCard(program) {
    const t = norm(program.type);
    const card = cardShell(program, "behavior-card");
    // Type modifier class drives per-type card width (Frequency is half-width).
    const typeClass =
      t === TYPE.FREQUENCY ? "bc-freq"
      : t === TYPE.RATE ? "bc-rate"
      : t === TYPE.INTERVAL ? "bc-interval"
      : "bc-duration";
    card.classList.add(typeClass);

    if (t === TYPE.FREQUENCY || t === TYPE.RATE) {
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = t === TYPE.RATE ? "Rate — tally" : "Frequency — tally";
      card.appendChild(sub);
      const box = document.createElement("div");
      box.className = "tally-box";
      card.appendChild(box);
    } else if (t === TYPE.INTERVAL) {
      const n = program._params.intervals || DEFAULTS.intervals;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = `Interval — ${n} intervals`;
      card.appendChild(sub);
      card.appendChild(boxRow(n));
    } else if (t === TYPE.DURATION) {
      const n = program._params.slots || DEFAULTS.slots;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = `Duration — ${n} slots`;
      card.appendChild(sub);
      const list = document.createElement("div");
      list.className = "slot-list";
      for (let i = 1; i <= n; i++) {
        const slot = document.createElement("div");
        slot.className = "slot-row";
        slot.innerHTML = `<span class="slot-label">${i}.</span><span class="slot-line"></span>`;
        list.appendChild(slot);
      }
      card.appendChild(list);
    }
    return card;
  }

  function skillCard(program) {
    const t = norm(program.type);
    const card = cardShell(program, "skill-card");

    if (t === TYPE.TRIAL) {
      const n = program._params.minTrials || DEFAULTS.minTrials;
      // Only plot targets the user kept enabled.
      const targets = program.targets.length
        ? program.targets.filter((_, i) => program._targetsEnabled[i])
        : [program.title];
      targets.forEach((tg) => {
        const trow = document.createElement("div");
        trow.className = "target";
        const label = document.createElement("div");
        label.className = "target-label";
        label.textContent = tg;
        trow.appendChild(label);
        trow.appendChild(trialGrid(n));
        card.appendChild(trow);
      });
    } else if (t === TYPE.TASK) {
      const n = program._params.steps || DEFAULTS.steps;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = `Task analysis — ${n} steps`;
      card.appendChild(sub);
      card.appendChild(boxRow(n));
    } else {
      // Fallback (e.g. unknown skill type): show targets with single boxes.
      (program.targets.length ? program.targets : [program.title]).forEach((tg) => {
        const trow = document.createElement("div");
        trow.className = "target";
        trow.innerHTML = `<div class="target-label">${escapeHtml(tg)}</div>`;
        trow.appendChild(boxRow(1));
        card.appendChild(trow);
      });
    }
    return card;
  }

  // A trial-by-trial target: graph-paper row of `n` cells + Additional Trials.
  function trialGrid(n) {
    const wrap = document.createElement("div");
    wrap.className = "trial-wrap";

    const grid = document.createElement("div");
    grid.className = "trial-grid";
    grid.style.setProperty("--cells", n);
    for (let i = 0; i < n; i++) {
      const c = document.createElement("span");
      c.className = "cell";
      grid.appendChild(c);
    }
    wrap.appendChild(grid);

    const addl = document.createElement("div");
    addl.className = "addl";
    addl.innerHTML = `<span class="addl-label">Add'l trials</span><span class="addl-box"></span>`;
    wrap.appendChild(addl);

    return wrap;
  }

  // A plain row of `n` square boxes (intervals / task-analysis steps).
  function boxRow(n) {
    const row = document.createElement("div");
    row.className = "box-row";
    row.style.setProperty("--cells", n);
    for (let i = 0; i < n; i++) {
      const c = document.createElement("span");
      c.className = "cell";
      row.appendChild(c);
    }
    return row;
  }

  // ---- View switching -----------------------------------------------------
  function showPreview() {
    buildSheet();
    el.paramsView.hidden = true;
    el.previewView.hidden = false;
    el.btnBuild.hidden = true;
    el.btnBack.hidden = false;
    el.btnPrint.hidden = false;
    el.btnPdf.hidden = false;
  }

  function showParams() {
    el.previewView.hidden = true;
    el.paramsView.hidden = false;
    el.btnBuild.hidden = false;
    el.btnBack.hidden = true;
    el.btnPrint.hidden = true;
    el.btnPdf.hidden = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
    );
  }

  // ---- Wire up ------------------------------------------------------------
  el.btnBuild.addEventListener("click", showPreview);
  el.btnBack.addEventListener("click", showParams);
  el.btnPrint.addEventListener("click", () => window.print());
  el.btnPdf.addEventListener("click", () => window.print());
  if (el.btnSample) {
    el.btnSample.addEventListener("click", () => {
      const programs = (window.RH_SAMPLE_DATA || []).map((p) => ({
        title: p.title,
        type: p.type,
        targets: p.targets || [],
      }));
      initData({
        clientId: "SAMPLE",
        scrapedAt: new Date().toISOString(),
        programs,
      });
    });
  }

  load();
})();
