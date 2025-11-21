/* ===== UI helpers ===== */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const status = (t, kind = "") => { const el = $("status"); if (el) el.textContent = t; };
let currentTranscript = null;

/* tiny helper for event binding by id */
function bind(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }

/* ===== persistent ui state ===== */
let sessionId = localStorage.getItem("lastSessionId") || null;
let transcriptId = localStorage.getItem("lastTranscriptId") || null;
let selected = new Set();     // selected segments on the current page
let speakers = ["Narrator", "Crudark", "Lift", "Johann", "Dain", "Truvik", "Inda", "Celestian", "Speaker A", "Speaker B"];

let pageSize = 200;
let offset = 0;
let total = 0;
let curItems = [];            // current page payload (server truth for this page)
// Calibration storage: pairs of {expected, seen}
let calibs = [];

function formatTimeSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  let t = Math.abs(n);

  const whole = Math.floor(t);
  let frac = Math.round((t - whole) * 1000); // ms
  let s = whole % 60;
  let m = Math.floor(whole / 60) % 60;
  let h = Math.floor(whole / 3600);

  const pad2 = (x) => String(x).padStart(2, "0");

  // carry if we rounded up to 1000ms
  if (frac === 1000) {
    frac = 0;
    s += 1;
    if (s === 60) { s = 0; m += 1; }
    if (m === 60) { m = 0; h += 1; }
  }

  let base;
  if (h > 0) base = `${h}:${pad2(m)}:${pad2(s)}`;
  else base = `${m}:${pad2(s)}`;

  if (frac > 0) return `${sign}${base}.${String(frac).padStart(3, "0")}`;
  return sign + base;
}

// parse mm:ss(.mmm) or plain seconds to number
// "1:23:45.678" / "12:34.5" / "123.45" → seconds (Number)
function parseTimeLike(s) {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s !== "string") return NaN;
  s = s.trim();
  if (!s) return NaN;

  // H:MM:SS(.mmm)
  if (/^\d+:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    const [h, m, rest] = s.split(":");
    return Number(h) * 3600 + Number(m) * 60 + Number(rest);
  }

  // M:SS(.mmm)
  if (/^\d+:\d{2}(\.\d+)?$/.test(s)) {
    const [m, rest] = s.split(":");
    return Number(m) * 60 + Number(rest);
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}


/* ===== pronouns (two-gender only, with a neutral fallback) ===== */
const PRONOUNS = {
  male:   { subj: "he",   obj: "him",  possAdj: "his",  poss: "his",   refl: "himself" },
  female: { subj: "she",  obj: "her",  possAdj: "her",  poss: "hers",  refl: "herself" },
  they:   { subj: "they", obj: "them", possAdj: "their", poss: "theirs", refl: "themselves" }
};

// Keep this tiny and practical; extend as needed
const NAME_GENDER = {
  Crudark: "male",
  Lift: "male",
  Johann: "male",
  Dain: "male",
  Truvik: "male",
  Inda: "female",
  Celestian: "male",
  "Speaker A": "male",
  "Speaker B": "female"
};

function getPronounsFor(target) {
  if (!target) return PRONOUNS.they;
  const g = NAME_GENDER[target] || "they";
  return PRONOUNS[g] || PRONOUNS.they;
}

/* ===== address rewrite ===== */
/* You→We / You→NAME and I/me/my/mine/myself → NAME (segment-local rewrite) */
function fixAddressedTo(text, targetRaw) {
  const target = (targetRaw || "").trim();
  if (!target) return text;

  // --- Mode A: you → we/us/our ---
  if (target.toLowerCase() === "we") {
    const rules = [
      { re: /\byou’re\b/gi, repl: "we’re" }, { re: /\byou're\b/gi, repl: "we're" },
      { re: /\byou’ve\b/gi, repl: "we've" }, { re: /\byou've\b/gi, repl: "we've" },
      { re: /\byou’ll\b/gi, repl: "we'll" }, { re: /\byou'll\b/gi, repl: "we'll" },
      { re: /\byou’d\b/gi, repl: "we'd" },  { re: /\byou'd\b/gi, repl: "we'd" },
      { re: /\byou are\b/gi, repl: "we are" }, { re: /\byou were\b/gi, repl: "we were" },
      { re: /\byou have\b/gi, repl: "we have" }, { re: /\byou had\b/gi, repl: "we had" },
      { re: /\b(are|were|do|did|does|can|could|will|would|should|have|has|had)\s+you\b/gi, repl: "$1 we" },
      { re: /\byourself\b/gi, repl: "ourselves" }, { re: /\byourselves\b/gi, repl: "ourselves" },
      { re: /\byours\b/gi, repl: "ours" }, { re: /\byour\b/gi, repl: "our" },
      { re: /\b(to|for|with|at|from|of|by|about|like|than|around|near|after|before|without|between|among|over|under|inside|outside|into|onto|upon|beside|behind|within)\s+you\b/gi, repl: "$1 us" },
      { re: /\byou\b/gi, repl: "we" },
    ];
    const out = rules.reduce((t, r) => t.replace(r.re, r.repl), text);
    return out.replace(/(^|[.!?]\s+)(we)\b/g, (_, pre) => pre + "We"); // capitalize sentence-initial "we"
  }

  // --- Mode B: you/I → NAME (plus proper reflexive via pronouns) ---
  const name = target;
  const p = getPronounsFor(name);

  // 1) First-person core forms
  const firstPersonCore = [
    { re: /\bI’m\b/g, repl: `${name}’s` }, { re: /\bI'm\b/g, repl: `${name}'s` },
    { re: /\bI am\b/g, repl: `${name} is` },
    { re: /\bI was\b/g, repl: `${name} was` },
    { re: /\bI’ve\b/g, repl: `${name} has` }, { re: /\bI've\b/g, repl: `${name} has` },
    { re: /\bI have\b/g, repl: `${name} has` },
    { re: /\bI’d\b/g, repl: `${name} would` }, { re: /\bI'd\b/g, repl: `${name} would` },
    { re: /\bI had\b/g, repl: `${name} had` },
    { re: /\bI’ll\b/g, repl: `${name} will` }, { re: /\bI'll\b/g, repl: `${name} will` },
    { re: /\bI will\b/g, repl: `${name} will` },
    { re: /\bI\b/g, repl: name }
  ];

  // 2) First-person extras
  const firstPersonExtras = [
    { re: /\bmy\b/gi, repl: `${name}'s` },
    { re: /\bmine\b/gi, repl: `${name}'s` },
    { re: /\bmyself\b/gi, repl: p.refl },  // e.g., "himself"/"herself"
    { re: /\bme\b/gi, repl: name }
  ];

  // 3) Second-person → NAME, including correct reflexive
  const secondPerson = [
    { re: /\byou’re\b/gi, repl: `${name}’s` }, { re: /\byou're\b/gi, repl: `${name}'s` },
    { re: /\byou’ve\b/gi, repl: `${name} has` }, { re: /\byou've\b/gi, repl: `${name} has` },
    { re: /\byou’ll\b/gi, repl: `${name} will` }, { re: /\byou'll\b/gi, repl: `${name} will` },
    { re: /\byou’d\b/gi, repl: `${name} would` }, { re: /\byou'd\b/gi, repl: `${name} would` },
    { re: /\byou are\b/gi, repl: `${name} is` },   { re: /\bare you\b/gi, repl: `is ${name}` },
    { re: /\byou were\b/gi, repl: `${name} was` }, { re: /\bwere you\b/gi, repl: `was ${name}` },
    { re: /\byou have\b/gi, repl: `${name} has` }, { re: /\bhave you\b/gi, repl: `has ${name}` },
    { re: /\byou had\b/gi, repl: `${name} had` },  { re: /\bhad you\b/gi, repl: `had ${name}` },
    { re: /\byourself\b/gi, repl: p.refl },        // ← FIXED: was `${name}self`
    { re: /\byours\b/gi, repl: `${name}'s` },
    { re: /\byour\b/gi, repl: `${name}'s` },
    { re: /\b(to|for|with|at|from|of|by|about|like|than|around|near|after|before|without|between|among|over|under|inside|outside|into|onto|upon|beside|behind|within)\s+you\b/gi, repl: `$1 ${name}` },
    { re: /\byou\b/gi, repl: name }
  ];

  let out = firstPersonCore.reduce((t, r) => t.replace(r.re, r.repl), text);
  out = firstPersonExtras.reduce((t, r) => t.replace(r.re, r.repl), out);
  out = secondPerson.reduce((t, r) => t.replace(r.re, r.repl), out);

  // Capitalize sentence-initial name (e.g., “is Truvik” already handled above)
  out = out.replace(/(^|[.!?]\s+)(truvik|crudark|lift|johann|dain|inda|celestian)\b/gi,
                    (_, pre, who) => pre + who.charAt(0).toUpperCase() + who.slice(1));
  return out;
}

// Compute least-squares affine fit new = a*old + b
function fitAffine(pairs) {
  // pairs: [{x: old, y: new}]
  const n = pairs.length;
  if (!n) return { a: 1, b: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const { x, y } of pairs) {
    sx += x; sy += y; sxx += x*x; sxy += x*y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { a: 1, b: (sy / n) - (sx / n) }; // fallback
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  return { a, b };
}

function updateCalibInfo() {
  const el = $("calibInfo");
  if (!el) return;
  el.textContent = calibs.length
    ? `Calibs: ${calibs.length}`
    : "";
}

// Add current point: expected = segment start, seen = player currentTime (or prompt)
async function addCalibrationPoint() {
  const a = $("player");
  const card = document.activeElement?.closest?.(".seg") || $$("#segments .seg")[0];
  if (!card) return status("Focus a segment first.");

  const expTxt = card.querySelector(".tstart")?.textContent || "0";
  const expected = parseTimeLike(expTxt);
  if (!Number.isFinite(expected)) return status("Segment has no start time.", "err");

  let seen = a ? a.currentTime : NaN;
  if (!Number.isFinite(seen)) {
    const s = prompt("Audio time for this line? (mm:ss or seconds)");
    seen = parseTimeLike(s || "");
  }
  if (!Number.isFinite(seen)) return status("Invalid audio time.", "err");

  calibs.push({ x: expected, y: seen });
  updateCalibInfo();
  status(`Added calib: ${expected.toFixed(2)} → ${seen.toFixed(2)}`);
}

async function applyAffineFromCalibs() {
  if (!transcriptId) return status("Open a transcript first.");
  if (calibs.length < 2 && !confirm("Only one calib point—this will behave like a pure offset. Continue?")) return;

  const { a, b } = fitAffine(calibs);
  status(`Applying affine: a=${a.toFixed(6)}, b=${b.toFixed(3)}…`);

  const r = await fetch(`/api/transcripts/${transcriptId}/apply-affine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a, b })
  }).then(x => x.json());

  if (r.error) return status(r.error, "err");
  await loadPage(false);
  status(`Affine applied to ${r.updated} segments. a=${a.toFixed(6)}, b=${b.toFixed(3)}`);
}


/* ===== fetch helpers ===== */
async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function save(id, patch) {
  const r = await fetch(`/api/segments/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(`Save failed (${r.status}): ${msg}`);
  }
  return r.json().catch(() => ({}));
}
function refreshSelectedCount() {
  const btn = $("bulkDelete");
  if (!btn) return;
  const n = selected.size || 0;
  btn.textContent = n ? `Delete ${n} selected segments` : "Delete selected segments";
  btn.disabled = n === 0;
}



/* ===== speakers ===== */
function speakerOptions(selected = "") {
  return ["", ...speakers]
    .map(s => `<option value="${s}" ${s === selected ? "selected" : ""}>${s || "(no speaker)"}</option>`)
    .join("");
}

/* ===== grouping (view only) ===== */
function groupify(items, maxChars = 320) {
  const out = []; let cur = null;
  for (const it of (items || [])) {
    const sameSpeaker = cur && cur.speakerName === (it.speakerName || "");
    const wouldExceed = cur && (cur.text.length + 1 + (it.text || "").length) > maxChars;
    if (!cur || !sameSpeaker || wouldExceed) {
      if (cur) out.push(cur);
      cur = { ...it };  // keep id & fields
    } else {
      cur.text = (cur.text + " " + it.text).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}
function updateAudioUploadEnabled() {
  const upLbl = document.querySelector('label[for="audioFile"]');
  const upInp = $("audioFile");
  const enabled = !!transcriptId;
  if (upLbl) upLbl.style.opacity = enabled ? "1" : "0.5";
  if (upLbl) upLbl.style.pointerEvents = enabled ? "auto" : "none";
  if (upInp) upInp.disabled = !enabled;
}

/* ===== render ===== */
function render(items) {
  curItems = items || [];
  const list = $("groupView")?.checked ? groupify(curItems) : curItems;

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const root = $("segments");
  if (!root) return;

  if (!list.length) {
    root.innerHTML = `<div class="empty">No segments on this page.</div>`;
    updateCounters();
    return;
  }

  root.innerHTML = list.map((s, index) => {
    const id = s.id;
    const speaker = s.speakerName || "";
    const text = s.text || "";
    const noSpCls = speaker ? "" : " no-speaker";

    // 🔧 ADD THESE TWO LINES:
    const start = Number(s.startSec);
    const end   = Number(s.endSec);

    return `
      <div class="seg${noSpCls}" data-id="${esc(id)}">
        <header>
          <div class="cluster media">
            <input type="checkbox" class="sel" name="select-${esc(id)}" />
           <b style="color:#ffff;font-size:11px;font-family:monospace;margin:0 5px">
            #${s.absolutePosition || (offset + index + 1)}
          </b>
        
            <span class="time-badge">
              <span class="tstart"
                    title="${Number.isFinite(start) ? start.toFixed(3) + " s" : ""}">
                ${formatTimeSec(start)}
              </span>–
              <span class="tend"
                    title="${Number.isFinite(end) ? end.toFixed(3) + " s" : ""}">
                ${formatTimeSec(end)}
              </span>
            </span>

<!-- Set Start (use Skip Back icon) -->
<button type="button" class="icon-btn set-start" title="Set start = player time (Alt+S)" aria-label="Set Start">
  <!-- skip backward: bar + two left triangles -->
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="3" width="2.6" height="18" rx="1" fill="currentColor"/>
    <polygon points="20,6 12.5,12 20,18" fill="currentColor"/>
    <polygon points="14,6 6.5,12 14,18" fill="currentColor"/>
  </svg>
</button>

<!-- Set End (use Skip Forward icon) -->
<button type="button" class="icon-btn set-end" title="Set end = player time (Alt+E)" aria-label="Set End">
  <!-- skip forward: two right triangles + bar -->
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="4,6 11.5,12 4,18" fill="currentColor"/>
    <polygon points="10,6 17.5,12 10,18" fill="currentColor"/>
    <rect x="18.4" y="3" width="2.6" height="18" rx="1" fill="currentColor"/>
  </svg>
</button>


  </div>

  <!-- middle-left: addressed-to (no always-visible label) -->
  <div class="cluster address">
    <select class="addressedTo" title="Target for You→Name">
      ${["", "We", ...speakers]
        .map(v => `<option value="${v}" ${v===(speaker||"")?"selected":""}>${v||"(addressed to…)"}</option>`)
        .join("")}
    </select>
    <button type="button" class="btn you2name" title="Rewrite 'you' → selected name">You→Name</button>
    <button type="button" class="btn you2we"   title="Rewrite 'you' → we/us/our">You→We</button>
  </div>

  <!-- middle-right: structure tools -->
  <div class="cluster">
    <button type="button" class="btn ins-above" title="Insert above">+ Above</button>
    <button type="button" class="btn ins-below" title="Insert below">+ Below</button>
    <button type="button" class="btn merge-up"  title="Merge into previous">Merge ↑</button>
  </div>

  <!-- right: speaker + actions -->
  <div class="cluster" style="margin-left:auto">
    <span class="pill">${speaker || "—"}</span>
    <select class="speaker">${speakerOptions(speaker)}</select>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <button type="button" class="btn copy"  title="Copy text">Copy</button>
      <button type="button" class="btn del"   title="Delete segment" style="border-color:#5a1a1a;">Delete</button>
    </div>
        <button type="button" class="btn play"
              data-start="${Number.isFinite(start) ? start : 0}"
              data-end="${Number.isFinite(end) ? end : 0}"
            >▶︎</button>
  </div>
</header>

        <textarea class="text" spellcheck="false">${esc(text)}</textarea>
      </div>`;
  }).join("");

  // Wire per-card behavior
  $$("#segments .seg").forEach(card => {
    const id = card.dataset.id;
    const ta = card.querySelector(".text");
    const pill = card.querySelector(".pill");
    const spSel = card.querySelector(".speaker");
    const atSel = card.querySelector(".addressedTo");

    // checkbox → selected set
    const cb = card.querySelector(".sel");
    if (cb) cb.addEventListener("change", () => {
      if (cb.checked) selected.add(id); else selected.delete(id);
      refreshSelectedCount();
    });

    // play snippet
// play snippet (robust seek for long audio)
const playBtn = card.querySelector(".play");
if (playBtn) {
  playBtn.addEventListener("click", (e) => {
    const audio = $("player");
    if (!audio || !audio.src) { status("Attach audio to this transcript first."); return; }

    const start = parseFloat(playBtn.dataset.start || "0") || 0;
    const end   = parseFloat(playBtn.dataset.end   || "0") || 0;

    // Hold Alt for 2s preroll (helpful for speaker ID)
    const preroll = e.altKey ? 2.0 : 0.0;
    const target  = Math.max(0, start - preroll);

    // Stop any previous segment stopper
    if (audio._segStopper) {
      audio.removeEventListener("timeupdate", audio._segStopper);
      audio._segStopper = null;
    }

    // Fresh stopper for this segment
    const stopAtEnd = (ev) => {
      // small epsilon to avoid micro-overshoots
      if (end > 0 && ev.target.currentTime >= end - 0.03) {
        ev.target.pause();
        ev.target.removeEventListener("timeupdate", stopAtEnd);
        audio._segStopper = null;
      }
    };
    audio._segStopper = stopAtEnd;
    audio.addEventListener("timeupdate", stopAtEnd);

    const playFrom = () => {
      // Prefer fastSeek for giant files if available
      if (typeof audio.fastSeek === "function") {
        try { audio.fastSeek(target); } catch { audio.currentTime = target; }
      } else {
        audio.currentTime = target;
      }
      audio.play().catch(()=>{ /* ignore user-gesture/autoplay blocks */ });
    };

    // If we already know duration/metadata, seek immediately; else wait
    if (audio.readyState >= 1) {
      playFrom();
    } else {
      const onMeta = () => { audio.removeEventListener("loadedmetadata", onMeta); playFrom(); };
      audio.addEventListener("loadedmetadata", onMeta);
      // In case the file is already loading, nudge it
      audio.load?.();
    }
  });
}


    // speaker change → pill + save + sync addressedTo
    if (spSel) spSel.addEventListener("change", async (e) => {
      const newSpeaker = (e.target.value || "").trim();
      if (pill) pill.textContent = newSpeaker || "—";
      if (atSel) atSel.value = newSpeaker || "";
      card.classList.toggle("no-speaker", !newSpeaker);
      try {
        await save(id, { speakerName: newSpeaker || null });
        const item = curItems.find(x => String(x.id) === String(id));
        if (item) item.speakerName = newSpeaker || "";
        status(`Speaker set to ${newSpeaker || "—"}.`);
      } catch (err) {
        console.error(err); status("Failed to save speaker.", "err");
      }
    });

    // You→We
    const btnWe = card.querySelector(".you2we");
    if (btnWe) btnWe.addEventListener("click", async () => {
      if (!ta) return;
      const before = ta.value;
      const after = fixAddressedTo(before, "we");
      if (after === before) { status("No “you” forms found to convert to we/us/our."); return; }
      ta.value = after;
      try {
        await save(id, { text: after });
        const item = curItems.find(x => String(x.id) === String(id));
        if (item) item.text = after;
        status("Rewrote “you” → we/us/our.");
      } catch (e) { console.error(e); status("Failed to save You→We change.", "err"); }
    });

    // You→Name (segment-only): Addressed-to → speaker → pill
    const btnName = card.querySelector(".you2name");
    if (btnName) btnName.addEventListener("click", async () => {
      if (!ta) return;
      const fromAddr = atSel?.value?.trim() || "";
      const fromSpk = spSel?.value?.trim() || "";
      const pillTxt = (pill?.textContent || "").trim();
      const who = fromAddr || fromSpk || (pillTxt === "—" ? "" : pillTxt) || "";
      if (!who) { status("Pick 'Addressed to' (or set speaker) on this segment."); return; }

      const before = ta.value;
      const after = fixAddressedTo(before, who); // no I→NAME (you said you'd fix grammar manually)
      if (after === before) { status(`No “you” forms to rewrite for ${who}.`); return; }

      ta.value = after;
      try {
        await save(id, { text: after });
        const item = curItems.find(x => String(x.id) === String(id));
        if (item) item.text = after;
        status(`Rewrote address to ${who}.`);
      } catch (e) { console.error(e); status("Failed to save You→Name change.", "err"); }
    });

    // Insert Above/Below → inline composer
    const btnAbove = card.querySelector(".ins-above");
    const btnBelow = card.querySelector(".ins-below");
    if (btnAbove) btnAbove.addEventListener("click", () => openInlineComposer(card, "above"));
    if (btnBelow) btnBelow.addEventListener("click", () => openInlineComposer(card, "below"));

    // Merge ↑ : append this text to previous segment, save prev (text + endSec), delete this
const btnMerge = card.querySelector(".merge-up");
if (btnMerge) btnMerge.addEventListener("click", async () => {
  const prev = card.previousElementSibling;
  if (!prev || !prev.classList.contains("seg")) { status("No segment above to merge into."); return; }

  const prevId  = prev.dataset.id;
  const prevTa  = prev.querySelector(".text");

  const thisTxt = (ta?.value || "").trim();
  if (!thisTxt) { status("Nothing to merge."); return; }

  // Build new previous text
  const newPrevText = ((prevTa?.value || "").trim() + " " + thisTxt).replace(/\s+/g, " ").trim();

  // Determine updated end time for previous = max(prev.end, this.end) when available
  // Read time from display element (which shows formatted time like "47:20.140")
  const readTimeFromDisplay = (el, sel) => {
    const timeEl = el?.querySelector(sel);
    if (!timeEl) return null;
    // Use the title attribute which contains the raw seconds value
    const titleSec = parseFloat(timeEl.getAttribute("title") || "");
    if (Number.isFinite(titleSec)) return titleSec;
    // Fallback: parse the formatted text content
    return parseTimeLike(timeEl.textContent || "");
  };
  const prevEnd  = readTimeFromDisplay(prev, ".tend");
  const thisEnd  = readTimeFromDisplay(card, ".tend");
  const newEnd   = (thisEnd != null && prevEnd != null) ? Math.max(prevEnd, thisEnd)
                 : (thisEnd != null ? thisEnd
                 :  prevEnd); // if only one is known, keep it

  try {
    // Save text + (optionally) endSec on previous
    const patch = { text: newPrevText };
    if (newEnd != null) patch.endSec = newEnd;

    await save(prevId, patch);

    // Reflect on UI immediately
    if (prevTa) prevTa.value = newPrevText;
    if (newEnd != null) {
      const tendPrev = prev.querySelector(".tend");
      if (tendPrev) {
        tendPrev.textContent = formatTimeSec(newEnd);
        tendPrev.setAttribute("title", newEnd.toFixed(3) + " s");
      }
      
      // CRITICAL FIX: Also update the play button's dataset.end
      const playBtnPrev = prev.querySelector(".play");
      if (playBtnPrev) playBtnPrev.dataset.end = String(newEnd);
      
      const backingPrev = curItems.find(x => String(x.id) === String(prevId));
      if (backingPrev) backingPrev.endSec = newEnd;
    }

    // Delete this segment
    const r = await fetch(`/api/segments/${id}`, { method: "DELETE" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);

    total = Math.max(0, total - 1);
    await loadPage(false);
    status("Merged into previous and updated end time.");
  } catch (e) {
    console.error(e);
    status("Merge failed.", "err");
  }
});

// --- AUTOSAVE: textarea edits (debounced) ---
if (ta) {
  const backing = curItems.find(x => String(x.id) === String(id));
let lastSaved = (backing?.text ?? (ta ? ta.value : ""));

  let saveTimer = null;

  async function pushSave(val) {
    if (val === lastSaved) return;
    await save(id, { text: val });
    lastSaved = val;
    const item = curItems.find(x => String(x.id) === String(id));
    if (item) item.text = val;
    status("Saved.");
  }

  ta.addEventListener("input", () => {
    clearTimeout(saveTimer);
    const val = ta.value;
    if (val.trim().length === 0) return;       // don’t auto-delete on empty
    saveTimer = setTimeout(() => { pushSave(val).catch(e=>status("Save failed: "+e.message,"err")); }, 500);
  });

  ta.addEventListener("blur", () => {
    clearTimeout(saveTimer);
    const val = ta.value;
    if (val.trim().length === 0) {              // safe: restore instead of deleting
      ta.value = lastSaved;
      status("Cleared text not saved. Use Delete to remove this segment.");
      return;
    }
    pushSave(val).catch(e=>status("Save failed: "+e.message,"err"));
  });

  ta.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      clearTimeout(saveTimer);
      const val = ta.value;
      if (val.trim().length === 0) { ta.value = lastSaved; status("Cleared text not saved. Use Delete to remove this segment."); return; }
      pushSave(val).catch(e=>status("Save failed: "+e.message,"err"));
    }
  });
}


    // Copy
    const btnCopy = card.querySelector(".copy");
    if (btnCopy) btnCopy.addEventListener("click", async () => {
      const text = ta?.value || "";
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const tmp = document.createElement("textarea");
          tmp.value = text; tmp.style.position = "fixed"; tmp.style.opacity = "0";
          document.body.appendChild(tmp); tmp.select(); document.execCommand("copy"); document.body.removeChild(tmp);
        }
        status("Copied segment text.");
      } catch (err) { status("Copy failed: " + err.message); }
    });
const audio = $("player");

// helper to save and reflect on UI
// helper to save and reflect on UI
async function saveTimes(upd) {
  await save(id, upd);

  const item = curItems.find(x => String(x.id) === String(id));
  if (item) Object.assign(item, upd);

  if (upd.startSec != null) {
    const v = Number(upd.startSec);
    const ts = card.querySelector(".tstart");
    if (ts) {
      ts.textContent = formatTimeSec(v);
      ts.setAttribute("title", Number.isFinite(v) ? v.toFixed(3) + " s" : "");
    }
    const pb = card.querySelector(".play");
    if (pb && Number.isFinite(v)) pb.dataset.start = String(v);
  }

  if (upd.endSec != null) {
    const v = Number(upd.endSec);
    const te = card.querySelector(".tend");
    if (te) {
      te.textContent = formatTimeSec(v);
      te.setAttribute("title", Number.isFinite(v) ? v.toFixed(3) + " s" : "");
    }
    const pb = card.querySelector(".play");
    if (pb && Number.isFinite(v)) pb.dataset.end = String(v);
  }
}

const btnSetStart = card.querySelector(".set-start");
if (btnSetStart) btnSetStart.addEventListener("click", async () => {
  if (!audio || !audio.src) return status("Attach audio first.");
  const t = audio.currentTime || 0;
  // optional: auto-close the previous segment by setting its end to this start
  const prev = card.previousElementSibling;
  if (prev && prev.classList.contains("seg")) {
    const prevId = prev.dataset.id;
    await save(prevId, { endSec: t });
    const ts = prev.querySelector(".tend");
    if (ts) {
      ts.textContent = formatTimeSec(t);
      ts.setAttribute("title", t.toFixed(3) + " s");
    }
    const pb = prev.querySelector(".play");
    if (pb) pb.dataset.end = String(t);
  }
  await saveTimes({ startSec: t });
  status(`Start = ${t.toFixed(3)}s`);
});

const btnSetEnd = card.querySelector(".set-end");
if (btnSetEnd) btnSetEnd.addEventListener("click", async () => {
  if (!audio || !audio.src) return status("Attach audio first.");
  const t = audio.currentTime || 0;
  await saveTimes({ endSec: t });
  status(`End = ${t.toFixed(3)}s`);
});

    // Delete
    const btnDel = card.querySelector(".del");
    if (btnDel) btnDel.addEventListener("click", async () => {
      // if (!confirm("Delete this segment?")) return;
      try {
        const r = await fetch(`/api/segments/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        total = Math.max(0, total - 1);
        // keep pagination sane
        const pages = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
        offset = Math.min(offset, (pages - 1) * pageSize);
        await loadPage(false);
        status("Segment deleted.");
      } catch (e) { console.error(e); status("Delete failed."); }
    });
  });

  updateCounters();
}

/* inline composer for insert */
function openInlineComposer(containerEl, where) {
  if (containerEl.querySelector(".composer")) return;
  const id = containerEl.dataset.id;
  const currentSpeaker = containerEl.querySelector(".speaker")?.value || "";

  const div = document.createElement("div");
  div.className = "composer";
  div.style.marginTop = "6px";
  div.innerHTML = `
    <div class="row" style="gap:6px; align-items:flex-start;">
      <select class="composer-speaker">${speakerOptions(currentSpeaker)}</select>
      <textarea class="composer-text" placeholder="New segment text…"></textarea>
      <button class="btn composer-save">Insert ${where}</button>
      <button class="btn composer-cancel">Cancel</button>
    </div>`;
  
  // Position composer visually based on where we're inserting
  if (where === "above") {
    containerEl.insertAdjacentElement("beforebegin", div);
  } else {
    containerEl.insertAdjacentElement("afterend", div);
  }

  div.querySelector(".composer-cancel").addEventListener("click", () => div.remove());
  div.querySelector(".composer-save").addEventListener("click", async () => {
    const text = div.querySelector(".composer-text").value.trim();
    const speakerName = div.querySelector(".composer-speaker").value || null;
    if (!text) { status("Enter some text"); return; }

    const whereApi = where === "above" ? "before" : "after";
    
    // Calculate timing: 1ms duration segment positioned relative to anchor
    const backing = curItems.find(x => String(x.id) === String(id));
    let startSec, endSec;
    
    if (backing) {
      if (where === "above") {
        // Before: end at anchor's start, 1ms duration
        if (Number.isFinite(backing.startSec)) {
          endSec = backing.startSec;
          startSec = Math.max(0, backing.startSec - 0.001);
        }
      } else {
        // After: start at anchor's end, 1ms duration
        if (Number.isFinite(backing.endSec)) {
          startSec = backing.endSec;
          endSec = backing.endSec + 0.001;
        }
      }
    }
    
    const payload = { where: whereApi, text, speakerName };
    if (startSec !== undefined) payload.startSec = startSec;
    if (endSec !== undefined) payload.endSec = endSec;
    
    const resp = await fetch(`/api/segments/${id}/insert`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const seg = await resp.json();
    if (!resp.ok || seg.error) { status(seg.error || "Insert failed"); return; }

    total = total + 1;
    await loadPage(false, seg.id);  // focus new seg if present
    status("Inserted.");
  });
}

/* ===== paging, counts, search/filter ===== */
function updateCounters() {
  const shown = $$("#segments .seg").length;
  const lbl = $("segCountFloat");
  if (lbl) lbl.textContent = `Segments (${shown} shown of ${total})`;
}
function syncPageSizeSelects() {
  const top = $("pageSize"), bot = $("pageSizeBottom");
  if (top) top.value = String(pageSize);
  if (bot) bot.value = String(pageSize);
}
function updatePagerUI() {
  const pageNo = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const info = `Page ${pageNo} / ${pages}`;
  const set = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  set("pageInfo", info); set("pageInfoBottom", info);

  const atStart = offset <= 0, atEnd = offset + pageSize >= total;
  const dis = (id, d) => { const el = $(id); if (el) el.disabled = !!d; };
  dis("prevPage", atStart); dis("nextPage", atEnd);
  dis("prevPageBottom", atStart); dis("nextPageBottom", atEnd);

  syncPageSizeSelects();
}

// Jump to next segment without speaker
async function jumpToNextNoSpeaker() {
  // First check current page for a segment without speaker after the focused one
  const allSegs = $$("#segments .seg");
  const focusedIndex = allSegs.findIndex(seg => seg.querySelector(".text:focus"));
  
  // Look for next no-speaker on current page (after focused element)
  for (let i = focusedIndex + 1; i < allSegs.length; i++) {
    if (allSegs[i].classList.contains("no-speaker")) {
      allSegs[i].scrollIntoView({ behavior: "smooth", block: "center" });
      allSegs[i].querySelector(".text")?.focus();
      status("Jumped to next segment without speaker.");
      return;
    }
  }
  
  // Not found on current page, try next page
  if (offset + pageSize < total) {
    offset += pageSize;
    await loadPage(false);
    
    // After loading, check for first no-speaker on new page
    const newSegs = $$("#segments .seg");
    for (let i = 0; i < newSegs.length; i++) {
      if (newSegs[i].classList.contains("no-speaker")) {
        newSegs[i].scrollIntoView({ behavior: "smooth", block: "center" });
        newSegs[i].querySelector(".text")?.focus();
        status("Jumped to next segment without speaker (next page).");
        return;
      }
    }
    
    // Keep searching subsequent pages
    status("Searching subsequent pages...");
    jumpToNextNoSpeaker(); // recursive call
  } else {
    status("No more segments without speaker found.");
  }
}

// full drop-in replacement
async function loadPage(force = false) {
  // ---- snapshot audio (before any DOM work)
  const old = $("player");
  const snap = old ? {
    had: true,
    t: Number.isFinite(old.currentTime) ? old.currentTime : 0,
    playing: !old.paused,
    lastId: window._lastAudioTranscriptId || null,
    lastUrl: old.getAttribute("data-audio-url") || old.getAttribute("src") || ""
  } : { had: false };

  // ---- fetch transcript header (so we know audioUrl, fileName, etc.)
  currentTranscript = null;
  if (!transcriptId) {
    // clear list if nothing selected
    curItems = [];
    total = 0;
    render(curItems);
    updatePagerUI?.();
    updateAudioUploadEnabled?.();
    return;
  }
  try {
    currentTranscript = await getJSON(`/api/transcripts/${transcriptId}`);
  } catch (e) {
    console.warn("Failed to load transcript header:", e);
    status?.("Failed to load transcript.", "err");
    currentTranscript = null;
  }

  // ---- (re)attach audio if needed and restore state if same file
  const player = $("player");
  const newUrl = currentTranscript?.audioUrl ? String(currentTranscript.audioUrl) : "";
  const newId  = currentTranscript?.id || null;

  if (player) {
    const curAttr = player.getAttribute("src") || "";
    const curData = player.getAttribute("data-audio-url") || "";
    const needAttach =
      !curAttr || !curData || curData !== newUrl || (window._lastAudioTranscriptId !== newId);

    if (newUrl && needAttach) {
      // normalize path to root (helps avoid relative 404s)
      const norm = newUrl.startsWith("/") ? newUrl : "/" + newUrl.replace(/^\/+/, "");
      player.setAttribute("src", norm);
      player.setAttribute("data-audio-url", newUrl);
      window._lastAudioTranscriptId = newId;
      try { player.load(); } catch {}
    }

    const sameAudio = snap.had && !needAttach && (snap.lastUrl === (player.getAttribute("data-audio-url") || ""));
    if (sameAudio) {
      if (snap.t > 0) {
        await Promise.resolve(); // let layout settle
        try {
          if (typeof player.fastSeek === "function") {
            try { player.fastSeek(snap.t); } catch { player.currentTime = snap.t; }
          } else {
            player.currentTime = snap.t;
          }
        } catch {}
      }
      if (snap.playing) player.play().catch(()=>{});
    }
  }

  // ---- fetch segments for current page with filters
  const speaker = $("speakerFilter")?.value || "";
  const q = $("search")?.value || "";
  const url = new URL(`/api/transcripts/${transcriptId}/segments`, window.location.origin);
  url.searchParams.set("limit", String(pageSize ?? 200));
  url.searchParams.set("offset", String(offset ?? 0));
  if (speaker) url.searchParams.set("speaker", speaker);
  if (q) url.searchParams.set("q", q);

  let resp;
  try {
    resp = await fetch(url, { cache: "no-store" }).then(r => r.json());
  } catch (e) {
    console.error(e);
    status?.("Failed to load segments.", "err");
    resp = { total: 0, items: [] };
  }

  total = Number(resp.total) || 0;
  curItems = Array.isArray(resp.items) ? resp.items : [];

  // ---- render + update UI
  render(curItems);
  if (q) $$('.seg b').forEach(b => b.style.color = '#888');
  updatePagerUI?.();
  updateAudioUploadEnabled?.();

  // ---- focus a specific segment if caller provided it
  if (typeof window.focusId !== "undefined" && window.focusId) {
    const el = document.querySelector(`.seg[data-id="${window.focusId}"] .text`);
    if (el) el.focus();
    window.focusId = null; // consume
  }
}

/* ===== sessions / transcripts ===== */
async function refreshSessions(selectId = null) {
  try {
    const sessions = await getJSON("/api/sessions");
    const sel = $("sessionSelect"); if (!sel) return;
    const prev = String(selectId || sessionId || sel.value || "");
    sel.innerHTML = `<option value="">— Open previous session —</option>` +
      sessions.map(s => `<option value="${s.id}">${s.title}</option>`).join("");
    if (prev && sessions.some(s => String(s.id) === prev)) sel.value = prev; else sel.value = "";
  } catch (e) { console.error("refreshSessions error:", e); }
}
async function refreshTranscriptsForSession(sid, pickId = null) {
  const tsel = $("transcriptSelect"); if (!tsel) return;
  if (!sid) { tsel.innerHTML = `<option value="">— Choose transcript —</option>`; return; }
  const list = await getJSON(`/api/sessions/${sid}/transcripts`);
  const prev = String(pickId || transcriptId || tsel.value || "");
  tsel.innerHTML = `<option value="">— Choose transcript —</option>` +
    list.map(t => `<option value="${t.id}">${t.fileName || t.id} — ${new Date(t.createdAt).toLocaleString()}</option>`).join("");
  if (prev && list.some(t => String(t.id) === prev)) tsel.value = prev; else tsel.value = "";
}

/* ===== one-off initializations ===== */
$("speakerFilter").innerHTML =
  `<option value="">All speakers</option>` + speakers.map(s => `<option value="${s}">${s}</option>`).join("");

window.addEventListener("DOMContentLoaded", async () => {
  await refreshSessions();
  if (sessionId) await refreshTranscriptsForSession(sessionId);

  if (transcriptId) {
    await loadPage(true);
    updateAudioUploadEnabled();
  } else if (sessionId) {
    try {
      const last = await getJSON(`/api/sessions/${sessionId}/last`);
      transcriptId = last.id;
      localStorage.setItem("lastTranscriptId", transcriptId);
      await loadPage(true);
      updateAudioUploadEnabled();
    } catch { /* no transcripts yet for that session */ }
  }
});

/* ===== toolbar & paging bindings ===== */
bind("prevPage", "click", () => { offset = Math.max(0, offset - pageSize); loadPage(); });
bind("nextPage", "click", () => { offset = Math.min(Math.max(0, total - pageSize), offset + pageSize); loadPage(); });
bind("prevPageBottom", "click", () => { offset = Math.max(0, offset - pageSize); loadPage(); });
bind("nextPageBottom", "click", () => { offset = Math.min(Math.max(0, total - pageSize), offset + pageSize); loadPage(); });
bind("jumpNoSpeaker", "click", jumpToNextNoSpeaker);
bind("jumpNoSpeakerBottom", "click", jumpToNextNoSpeaker);

bind("pageSize", "change", (e) => { pageSize = parseInt(e.target.value, 10) || 200; syncPageSizeSelects(); loadPage(true); });
bind("pageSizeBottom", "change", (e) => { pageSize = parseInt(e.target.value, 10) || 200; syncPageSizeSelects(); loadPage(true); });

let tSearch = null;
bind("search", "input", () => { clearTimeout(tSearch); tSearch = setTimeout(() => loadPage(true), 250); });
bind("speakerFilter", "change", () => loadPage(true));
bind("groupView", "change", () => render(curItems));
// Bind buttons
bind("calibAdd", "click", addCalibrationPoint);
bind("calibClear", "click", () => { calibs = []; updateCalibInfo(); status("Calibrations cleared."); });
bind("calibApply", "click", applyAffineFromCalibs);
bind("topPageBottom", "click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});


/* select all */
bind("selectAll", "change", (e) => {
  const check = !!e.target.checked;
  $$("#segments .seg .sel").forEach(cb => {
    cb.checked = check;
    const id = cb.closest(".seg").dataset.id;
    if (check) selected.add(id); else selected.delete(id);
  });
  refreshSelectedCount();
});

/* bulk delete */
bind("bulkDelete", "click", async () => {
  if (selected.size === 0) { status("No segments selected."); return; }
  // if (!confirm(`Delete ${selected.size} selected segment(s)?`)) return;
  const resp = await fetch("/api/segments/bulk-delete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentIds: Array.from(selected) })
  }).then(r => r.json());
  if (resp.error) return status(resp.error);
  total = Math.max(0, total - resp.count);
  const pages = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
  offset = Math.min(offset, (pages - 1) * pageSize);
  selected.clear(); 
  const sa = $("selectAll"); if (sa) sa.checked = false;
  refreshSelectedCount();
  await loadPage(false);
  status(`Deleted ${resp.count} segment(s).`);
});

/* mark matches */
bind("markMatches", "click", () => {
  const q = ($("markPattern")?.value || "").trim();
  if (!q) return;
  const needle = q.toLowerCase();
  let hits = 0;
  $$("#segments .seg").forEach(el => {
    const txt = el.querySelector(".text")?.value?.toLowerCase() || "";
    if (txt.includes(needle)) {
      const cb = el.querySelector(".sel");
      if (cb && !cb.checked) { cb.checked = true; hits++; }
      selected.add(el.dataset.id);
    }
  });
  status(`Marked ${hits} segment(s) containing "${q}".`);
  refreshSelectedCount();
});

/* clean current transcript */
bind("cleanCurrent", "click", async () => {
  if (!transcriptId) return status("No current transcript. Import first.");
  status("Cleaning current transcript…");
  const resp = await fetch(`/api/transcripts/${transcriptId}/cleanup`, { method: "POST" }).then(r => r.json());
  if (resp.error) return status(resp.error);
  status(`Cleaned: ${resp.updated} updated, ${resp.deleted} removed.`); loadPage(true);
});

/* clean by title */
bind("cleanByTitle", "click", async () => {
  const title = prompt("Enter session title to clean:"); if (!title) return;
  status(`Cleaning "${title}"…`);
  const resp = await fetch(`/api/transcripts/cleanup/by-title`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title })
  }).then(r => r.json());
  if (resp.error) return status(resp.error);

  sessionId = resp.sessionId || sessionId;
  transcriptId = resp.transcriptId;
  localStorage.setItem("lastSessionId", sessionId || "");
  localStorage.setItem("lastTranscriptId", transcriptId || "");
  await refreshSessions(sessionId);
  await loadPage(true);
  status(`Cleaned: ${resp.updated} updated, ${resp.deleted} removed.`);
});

/* export */
bind("exportChatGPT", "click", () => {
  if (!transcriptId) { status("Nothing open to export."); return; }
  const title = ($("title")?.value || "Transcript").trim();
  const url = `/api/export/transcript/${transcriptId}/novelize.txt?title=${encodeURIComponent(title)}&fallback=Narrator`;
  window.open(url, "_blank"); status("Exporting…");
});

/* copy all by speaker (current page) */
bind("copySpeaker", "click", async () => {
  const speaker = $("speakerFilter")?.value || "";
  if (!speaker) return status("Pick a speaker to copy.");
  const text = curItems.filter(s => (s.speakerName || "") === speaker).map(s => s.text).join("\n\n");
  if (!text) return status("No items on this page for that speaker.");
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const tmp = document.createElement("textarea");
      tmp.value = text; tmp.style.position = "fixed"; tmp.style.opacity = "0";
      document.body.appendChild(tmp); tmp.select(); document.execCommand("copy"); document.body.removeChild(tmp);
    }
    status(`Copied ${speaker} (current page).`);
  } catch (err) { status("Copy failed: " + err.message); }
});

bind("btnImportText", "click", async () => {
  const title = ($("title")?.value || "").trim();
  const text  = ($("raw")?.value || "").trim();
  if (!title) return status("Please enter a Session Title.");
  if (!text)  return status("Paste some transcript text or use file upload.");

  try {
    status("Importing pasted text…");
    const fd = new FormData();
    fd.append("title", title);
    fd.append("text", text);

    // If the user already picked an audio in the “Upload Audio” control, include it too
    const a = $("audioFile")?.files?.[0];
    if (a) fd.append("audio", a, a.name);

    const res  = await fetch("/api/import", { method: "POST", body: fd });
    const resp = await res.json();
    if (!res.ok || resp.error) throw new Error(resp.error || `${res.status} ${res.statusText}`);

    sessionId    = resp.session.id;
    transcriptId = resp.transcript.id;
    localStorage.setItem("lastSessionId", sessionId);
    localStorage.setItem("lastTranscriptId", transcriptId);

    // Clear inputs after success
    $("raw").value = "";
    if ($("audioFile")) $("audioFile").value = "";

    await refreshSessions(sessionId);
    await refreshTranscriptsForSession(sessionId, transcriptId);
    await loadPage(true);
    status(`Imported ${resp.segmentsCreated} segment(s) into “${resp.session.title}”.`);
  } catch (err) {
    console.error(err);
    status("Import failed: " + err.message, "err");
  }
});

bind("file", "change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  const title = ($("title")?.value || "").trim();
  if (!title) { status("Please enter a Session Title."); e.target.value = ""; return; }

  // pick the transcript and (optional) audio from the same selection
  const isTranscript = f => /\.(vtt|srt|txt)$/i.test(f.name);
  const isAudio = f => f.type.startsWith("audio/") || /\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i.test(f.name);

  const tr = files.find(isTranscript);
  const au = files.find(isAudio);

  if (!tr) { status("Select a .vtt / .srt / .txt transcript."); e.target.value = ""; return; }

  try {
    status(`Uploading ${tr.name}${au ? " + " + au.name : ""}…`);

    const fd = new FormData();
    fd.append("title", title);
    fd.append("file", tr, tr.name);
    if (au) fd.append("audio", au, au.name);                // attach audio from the same picker
    else {
      // fall back to the separate Upload Audio control if user picked it earlier
      const a2 = $("audioFile")?.files?.[0];
      if (a2) fd.append("audio", a2, a2.name);
    }

    const res  = await fetch("/api/import", { method: "POST", body: fd });
    const resp = await res.json();
    if (!res.ok || resp.error) throw new Error(resp.error || `${res.status} ${res.statusText}`);

    sessionId    = resp.session.id;
    transcriptId = resp.transcript.id;
    localStorage.setItem("lastSessionId", sessionId);
    localStorage.setItem("lastTranscriptId", transcriptId);

    // clear pickers after success
    e.target.value = "";
    if ($("audioFile")) $("audioFile").value = "";

    await refreshSessions(sessionId);
    await refreshTranscriptsForSession(sessionId, transcriptId);
    await loadPage(true);
    status(`Imported ${resp.segmentsCreated} from ${tr.name}${au ? " + " + au.name : ""}.`);
  } catch (err) {
    console.error(err);
    status("Upload failed: " + err.message, "err");
    e.target.value = "";
  }
});


/* session + transcript open/delete */
bind("sessionSelect", "change", async () => {
  const sid = $("sessionSelect")?.value || "";
  await refreshTranscriptsForSession(sid);
  if (!sid) return;
  try {
    const last = await getJSON(`/api/sessions/${sid}/last`);
    sessionId = sid; transcriptId = last.id;
    localStorage.setItem("lastSessionId", sessionId);
    localStorage.setItem("lastTranscriptId", transcriptId);
    await loadPage(true);
    updateAudioUploadEnabled();
  } catch { transcriptId = null; localStorage.removeItem("lastTranscriptId"); total = 0; curItems = []; render(curItems); }
});
bind("openSession", "click", async () => {
  const sel = $("sessionSelect"); const chosen = sel?.value || "";
  if (!chosen) { status("Pick a session to open."); return; }
  try {
    const last = await getJSON(`/api/sessions/${chosen}/last`);
    sessionId = chosen; transcriptId = last.id;
    localStorage.setItem("lastSessionId", sessionId);
    localStorage.setItem("lastTranscriptId", transcriptId);
    status(`Opened: ${sel.options[sel.selectedIndex].text}`); 
    offset = 0; 
    await loadPage(true);
     updateAudioUploadEnabled();
  } catch { status("That session has no transcripts yet."); }
});
bind("cleanSelected", "click", async () => {
  const tid = $("transcriptSelect")?.value || ""; if (!tid) return status("Pick a transcript to clean.");
  status("Cleaning selected transcript…");
  const resp = await fetch(`/api/transcripts/${tid}/cleanup`, { method: "POST" }).then(r => r.json());
  if (resp.error) return status(resp.error);
  status(`Cleaned: ${resp.updated} updated, ${resp.deleted} removed.`);
  transcriptId = tid; localStorage.setItem("lastTranscriptId", transcriptId);
  await loadPage(true);
  updateAudioUploadEnabled();
});
bind("deleteSelected", "click", async () => {
  const tid = $("transcriptSelect")?.value || ""; if (!tid) return status("Pick a transcript to delete.");
  if (!confirm("Delete this transcript (all its segments)?")) return;
  status("Deleting transcript…");
  await fetch(`/api/transcripts/${tid}`, { method: "DELETE" });
  if (transcriptId === tid) { transcriptId = null; localStorage.removeItem("lastTranscriptId"); total = 0; curItems = []; render(curItems); }
  const sid = $("sessionSelect")?.value || sessionId || "";
  await refreshTranscriptsForSession(sid);
  status("Transcript deleted.");
});

function refreshTranscriptDeleteEnabled() {
  const btn = $("deleteSelected");
  const tsel = $("transcriptSelect");
  if (btn && tsel) btn.disabled = !(tsel.value);
}

bind("transcriptSelect", "change", async () => {
  const tsel = $("transcriptSelect");
  transcriptId = tsel?.value || "";
  localStorage.setItem("lastTranscriptId", transcriptId || "");
  offset = 0;
  refreshTranscriptDeleteEnabled();
  await loadPage(true);  // also refreshes audio player src via the code we added
});
window.addEventListener("DOMContentLoaded", refreshTranscriptDeleteEnabled);

bind("openLatest", "click", async () => {
  try {
    const t = await getJSON("/api/resume"); // latest across all sessions
    sessionId = t.sessionId; transcriptId = t.id;
    localStorage.setItem("lastSessionId", sessionId);
    localStorage.setItem("lastTranscriptId", transcriptId);
    const sel = $("sessionSelect"); if (sel) sel.value = sessionId;
    status(`Opened latest: ${t.session?.title || t.id}`); offset = 0; await loadPage(true);
  } catch { status("No transcripts found."); }
});
bind("audioFile", "change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (!transcriptId) { status("Open or import a transcript first."); e.target.value = ""; return; }

  try {
    status(`Uploading audio: ${f.name}…`);
    const fd = new FormData();
    fd.append("audio", f);                         // field name must be 'audio'
    const res  = await fetch(`/api/transcripts/${transcriptId}/audio`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `${res.status} ${res.statusText}`);

    const player = $("player");
    if (player && data.audioUrl) player.src = data.audioUrl;
    status("Audio attached.");
  } catch (err) {
    console.error(err);
    status("Audio upload failed: " + err.message, "err");
  } finally {
    e.target.value = "";        // <— important so change fires next time
  }
});
// Position and toggle the calibration popover near the toggle button
function toggleCalibPopover(show) {
  const pop = $("calibPopover"); const btn = $("calibToggle");
  if (!pop || !btn) return;
  if (show === undefined) show = (pop.style.display === "none");
  pop.style.display = show ? "block" : "none";
  if (show) {
    const r = btn.getBoundingClientRect();
    // place below-right of the button
    pop.style.left = Math.round(r.left) + "px";
    pop.style.top  = Math.round(r.bottom + 6 + window.scrollY) + "px";
  }
}
// Close when clicking outside
document.addEventListener("click", (e)=>{
  const pop = $("calibPopover"); const btn = $("calibToggle");
  if (!pop || pop.style.display === "none") return;
  const inside = pop.contains(e.target) || btn.contains(e.target);
  if (!inside) toggleCalibPopover(false);
});

// Bind UI
bind("calibToggle","click", ()=> toggleCalibPopover());
bind("calibAdd","click", async ()=>{
  await addCalibrationPoint();
  updateCalibInfo();
});
bind("calibApply","click", async ()=>{
  await applyAffineFromCalibs();
  toggleCalibPopover(false);
});
bind("calibClear","click", ()=>{
  calibs = [];
  updateCalibInfo();
});


// Global media + calibration hotkeys
window.addEventListener("keydown", (ev) => {
const keyRaw   = ev.key;
  const keyLower = keyRaw.toLowerCase();
  if ((ev.ctrlKey || ev.metaKey) && keyLower === 'g') { ev.preventDefault(); goto(); return; }
  if ((ev.ctrlKey || ev.metaKey) && keyLower === 'j') { ev.preventDefault(); jumpToNextNoSpeaker(); return; }
  

  // DEBUG: prove the handler is firing
  console.log("[hotkey] keydown", {
    key: keyRaw,
    ctrl: ev.ctrlKey,
    alt: ev.altKey,
    meta: ev.metaKey,
    target: ev.target && ev.target.tagName
  });

  // --- Calibration tools (Alt+C/A/X) always active ---
  if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
    if (keyLower === "c") {
      ev.preventDefault();
      addCalibrationPoint().then(updateCalibInfo);
      return;
    } else if (keyLower === "a") {
      ev.preventDefault();
      applyAffineFromCalibs();
      return;
    } else if (keyLower === "x") {
      ev.preventDefault();
      calibs = [];
      updateCalibInfo();
      status("Calibrations cleared.");
      return;
    }
  }

  const a = $("player");
  if (!a || !a.src) return;

  const tag = (ev.target && ev.target.tagName ? ev.target.tagName.toUpperCase() : "");
  const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

  // While typing, allow:
  // - our Alt helpers
  // - Ctrl+ArrowLeft / Ctrl+ArrowRight (skip)
  const allowWhileTyping =
    (ev.altKey && ["s","e","p","c","a","x"].includes(keyLower)) ||
    (ev.ctrlKey && (keyRaw === "ArrowLeft" || keyRaw === "ArrowRight"));

  if (inField && !allowWhileTyping) {
    // DEBUG: show that we bailed because we're in a field
    console.debug("[hotkey] inField early-return", { key: keyRaw });
    return;
  }

  function seekBy(deltaSeconds) {
    const cur = a.currentTime || 0;
    const dur = Number.isFinite(a.duration) ? a.duration : 9e9;
    const target = Math.max(0, Math.min(dur, cur + deltaSeconds));
    if (typeof a.fastSeek === "function") {
      try { a.fastSeek(target); }
      catch { a.currentTime = target; }
    } else {
      a.currentTime = target;
    }
    console.debug("[hotkey] seekBy", deltaSeconds, "→", target);
  }

  // --- Ctrl+Arrow media-style skipping ---
  if (ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (keyRaw === "ArrowLeft") {
      ev.preventDefault();
      seekBy(-5);
      return;
    }
    if (keyRaw === "ArrowRight") {
      ev.preventDefault();
      seekBy(+5);
      return;
    }
    // Let other Ctrl+ combos behave normally
    return;
  }


  if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    if (keyLower === "k") { ev.preventDefault(); a.paused ? a.play() : a.pause(); return; }
    if (keyLower === "j") { ev.preventDefault(); seekBy(-5); return; }
    if (keyLower === "l") { ev.preventDefault(); seekBy(+5); return; }
    if (keyRaw === " ")   { ev.preventDefault(); a.paused ? a.play() : a.pause(); return; }
  }

  // --- Reserved Alt shortcuts for future segment controls ---
  if (ev.altKey) {
    if (keyLower === "s") { ev.preventDefault(); /* Set Start logic */ return; }
    if (keyLower === "e") { ev.preventDefault(); /* Set End logic   */ return; }
    if (keyLower === "p") { ev.preventDefault(); /* Play segment    */ return; }
    
  }
}, true); // capture phase
// Simple segment jump
window.goto = function(n) {
  n = n || parseInt(prompt('Go to segment number (1-' + total + '):'));
  if (n > 0 && n <= total) {
    offset = Math.floor((n-1)/pageSize) * pageSize;
    loadPage().then(() => {
      setTimeout(() => {
        const segs = document.querySelectorAll('.seg');
        segs.forEach((s, i) => {
          if (offset + i + 1 === n) {
            s.style.outline = '3px solid yellow';
            s.scrollIntoView({block:'center'});
            setTimeout(() => s.style.outline = '', 2000);
          }
        });
      }, 200);
    });
  }
};