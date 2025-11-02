/* ===== UI helpers ===== */
const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const status = (t, kind = "") => { const el = $("status"); if (el) el.textContent = t; };

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


/* ===== address rewrite ===== */
/* You→We and You→NAME (intentionally simple/predictable) */
function fixAddressedTo(text, targetRaw) {
  const target = (targetRaw || "").trim();
  if (!target) return text;

  // Capitalize "we" at sentence starts
  const capSentenceWe = t =>
    t.replace(/(^|[.!?]\s+)(we)\b/g, (_, pre, we) => pre + "We");

  // Mode A: you → we/us/our
  if (target.toLowerCase() === "we") {
    const rules = [
      { re: /\byou're\b/gi, repl: "we're" }, { re: /\byou’ve\b/gi, repl: "we've" }, { re: /\byou've\b/gi, repl: "we've" },
      { re: /\byou’ll\b/gi, repl: "we'll" }, { re: /\byou'll\b/gi, repl: "we'll" }, { re: /\byou’d\b/gi, repl: "we'd" },
      { re: /\byou'd\b/gi, repl: "we'd" },
      { re: /\byou are\b/gi, repl: "we are" }, { re: /\byou were\b/gi, repl: "we were" },
      { re: /\byou have\b/gi, repl: "we have" }, { re: /\byou had\b/gi, repl: "we had" },
      { re: /\b(are|were|do|did|does|can|could|will|would|should|have|has|had)\s+you\b/gi, repl: "$1 we" },
      { re: /\byourself\b/gi, repl: "ourselves" }, { re: /\byourselves\b/gi, repl: "ourselves" },
      { re: /\byours\b/gi, repl: "ours" }, { re: /\byour\b/gi, repl: "our" },
      { re: /\b(to|for|with|at|from|of|by|about|like|than|around|near|after|before|without|between|among|over|under|inside|outside|into|onto|upon|beside|behind|within)\s+you\b/gi, repl: "$1 us" },
      { re: /\byou\b/gi, repl: "we" },
    ];
    let out = rules.reduce((t, r) => t.replace(r.re, r.repl), text);
    return capSentenceWe(out);
  }

  // Mode B: you → NAME (Johnny, Dain, etc.)
  const name = target;
  const rules = [
    { re: /\byou’re\b/gi, repl: `${name}’s` }, { re: /\byou're\b/gi, repl: `${name}'s` },
    { re: /\byou’ve\b/gi, repl: `${name} has` }, { re: /\byou've\b/gi, repl: `${name} has` },
    { re: /\byou’ll\b/gi, repl: `${name} will` }, { re: /\byou'll\b/gi, repl: `${name} will` },
    { re: /\byou’d\b/gi, repl: `${name} would` }, { re: /\byou'd\b/gi, repl: `${name} would` },
    { re: /\byou are\b/gi, repl: `${name} is` }, { re: /\bare you\b/gi, repl: `is ${name}` },
    { re: /\byou were\b/gi, repl: `${name} was` }, { re: /\bwere you\b/gi, repl: `was ${name}` },
    { re: /\byou have\b/gi, repl: `${name} has` }, { re: /\bhave you\b/gi, repl: `has ${name}` },
    { re: /\byou had\b/gi, repl: `${name} had` }, { re: /\bhad you\b/gi, repl: `had ${name}` },
    { re: /\byourself\b/gi, repl: `${name}self` },
    { re: /\byours\b/gi, repl: `${name}'s` }, { re: /\byour\b/gi, repl: `${name}'s` },
    { re: /\b(to|for|with|at|from|of|by|about|like|than|around|near|after|before|without|between|among|over|under|inside|outside|into|onto|upon|beside|behind|within)\s+you\b/gi, repl: `$1 ${name}` },
    { re: /\byou\b/gi, repl: name },
  ];
  return rules.reduce((t, r) => t.replace(r.re, r.repl), text);
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

  root.innerHTML = list.map(s => {
    const id = s.id;
    const speaker = s.speakerName || "";
    const text = s.text || "";
    const noSpCls = speaker ? "" : " no-speaker";
    return `
      <div class="seg${noSpCls}" data-id="${esc(id)}">
        <header>
  <!-- left: play + timing tools -->
  <div class="cluster media">
    <input type="checkbox" class="sel" name="select-${esc(id)}" />
    <button type="button" class="btn play" data-start="${s.startSec || 0}" data-end="${s.endSec || 0}">▶︎</button>
    <span class="time-badge">
      <span class="tstart" title="startSec">${(s.startSec ?? "")}</span>–<span class="tend" title="endSec">${(s.endSec ?? "")}</span>
    </span>
    <button type="button" class="btn set-start" title="Set start = player time (Alt+S)">Set Start</button>
    <button type="button" class="btn set-end"   title="Set end = player time (Alt+E)">Set End</button>
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
    <button type="button" class="btn copy"  title="Copy text">Copy</button>
    <button type="button" class="btn del"   title="Delete segment" style="border-color:#5a1a1a;">Delete</button>
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

    // Merge ↑ : append this text to previous segment, save prev, delete this
    const btnMerge = card.querySelector(".merge-up");
    if (btnMerge) btnMerge.addEventListener("click", async () => {
      const prev = card.previousElementSibling;
      if (!prev || !prev.classList.contains("seg")) { status("No segment above to merge into."); return; }
      const prevId = prev.dataset.id;
      const prevTa = prev.querySelector(".text");
      const thisTxt = (ta?.value || "").trim();
      if (!thisTxt) { status("Nothing to merge."); return; }

      const newPrev = ((prevTa?.value || "").trim() + " " + thisTxt).replace(/\s+/g, " ").trim();
      try {
        await save(prevId, { text: newPrev });
        if (prevTa) prevTa.value = newPrev;
        // Delete this segment
        const r = await fetch(`/api/segments/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        total = Math.max(0, total - 1);
        await loadPage(false);
        status("Merged into previous.");
      } catch (e) { console.error(e); status("Merge failed."); }
    });

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
async function saveTimes(upd) {
  await save(id, upd);
  const item = curItems.find(x => String(x.id) === String(id));
  if (item) Object.assign(item, upd);
  if (upd.startSec != null) card.querySelector(".tstart").textContent = upd.startSec.toFixed(3);
  if (upd.endSec   != null) card.querySelector(".tend").textContent   = upd.endSec.toFixed(3);
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
    const ts = prev.querySelector(".tend"); if (ts) ts.textContent = t.toFixed(3);
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
      if (!confirm("Delete this segment?")) return;
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
  containerEl.appendChild(div);

  div.querySelector(".composer-cancel").addEventListener("click", () => div.remove());
  div.querySelector(".composer-save").addEventListener("click", async () => {
    const text = div.querySelector(".composer-text").value.trim();
    const speakerName = div.querySelector(".composer-speaker").value || null;
    if (!text) { status("Enter some text"); return; }

    const whereApi = where === "above" ? "before" : "after";
    const resp = await fetch(`/api/segments/${id}/insert`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where: whereApi, text, speakerName })
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
async function loadPage(reset = false, focusId = null) {
  if (!transcriptId) { total = 0; curItems = []; render(curItems); updatePagerUI(); return; }
  if (reset) offset = 0;
  // pull audio URL for current transcript and bind the <audio> player
  try {
    const tMeta = await getJSON(`/api/transcripts/${transcriptId}`);
    const audioEl = $("player");
    if (audioEl) {
      if (tMeta?.audioUrl) { audioEl.src = tMeta.audioUrl; }
      else { audioEl.removeAttribute("src"); }
    }
  } catch (_) { }

  const speaker = $("speakerFilter")?.value || "";
  const q = $("search")?.value || "";

  const url = new URL(`/api/transcripts/${transcriptId}/segments`, window.location.origin);
  url.searchParams.set("limit", pageSize);
  url.searchParams.set("offset", offset);
  if (speaker) url.searchParams.set("speaker", speaker);
  if (q) url.searchParams.set("q", q);

  const resp = await fetch(url, { cache: "no-store" }).then(r => r.json());
  total = resp.total || 0;
  curItems = resp.items || [];
  render(curItems);
  updatePagerUI();
  updateAudioUploadEnabled();


  if (focusId) {
    const el = document.querySelector(`.seg[data-id="${focusId}"] .text`);
    if (el) el.focus();
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

bind("pageSize", "change", (e) => { pageSize = parseInt(e.target.value, 10) || 200; syncPageSizeSelects(); loadPage(true); });
bind("pageSizeBottom", "change", (e) => { pageSize = parseInt(e.target.value, 10) || 200; syncPageSizeSelects(); loadPage(true); });

let tSearch = null;
bind("search", "input", () => { clearTimeout(tSearch); tSearch = setTimeout(() => loadPage(true), 250); });
bind("speakerFilter", "change", () => loadPage(true));
bind("groupView", "change", () => render(curItems));

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

/* import text / file */
bind("btnImportText", "click", async () => {
  const resp = await fetch("/api/import", { /* impl. omitted on server */ }).then(r => r.json());
  if (resp.error) return status(resp.error);
  sessionId = resp.session.id;
  transcriptId = resp.transcript.id;
  localStorage.setItem("lastSessionId", sessionId);
  localStorage.setItem("lastTranscriptId", transcriptId);
  status(`Imported ${resp.segmentsCreated} segments into “${resp.session.title}”.`);
  const raw = $("raw"); if (raw) raw.value = "";
  loadPage(true);
});
bind("file", "change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const title = $("title")?.value?.trim(); if (!title) return status("Please enter a Session Title.");
  status(`Uploading ${f.name}…`);
  const fd = new FormData(); fd.append("title", title); fd.append("file", f);
  const resp = await fetch("/api/import", { method: "POST", body: fd }).then(r => r.json());
  if (resp.error) return status(resp.error);
  transcriptId = resp.transcript.id; sessionId = resp.session.id;
  localStorage.setItem("lastSessionId", sessionId);
  localStorage.setItem("lastTranscriptId", transcriptId);
  status(`Imported ${resp.segmentsCreated} from ${f.name} into “${resp.session.title}”.`);
  e.target.value = ""; loadPage(true);
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


/* keyboard navi helpers */
document.addEventListener("keydown", (ev) => {
  const a = $("player"); if (!a) return;
  if (ev.target && /INPUT|TEXTAREA/i.test(ev.target.tagName)) return;
  if (ev.key === " ") { ev.preventDefault(); a.paused ? a.play() : a.pause(); }
  if (ev.key.toLowerCase() === "s") { a.pause(); }
});


/* float counter click → top */
const segFloat = $("segCountFloat");
if (segFloat && !segFloat.dataset.bound) {
  segFloat.dataset.bound = "1";
  segFloat.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}
