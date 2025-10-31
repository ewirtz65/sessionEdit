const $ = (id) => document.getElementById(id);
const status = (t) => { $("status").textContent = t; };
function bind(id, ev, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(ev, fn);
}
let sessionId = localStorage.getItem("lastSessionId") || null;
let transcriptId = localStorage.getItem("lastTranscriptId") || null;
let selected = new Set();
document.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  if (e.key === "[") { if (offset > 0) { offset = Math.max(0, offset - pageSize); loadPage(); } }
  if (e.key === "]") { if (offset + pageSize < total) { offset = Math.min(total - pageSize, offset + pageSize); loadPage(); } }
});

const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
// fetch helpers
async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
}
function fixAddressedTo(text, targetRaw) {
  const target = (targetRaw || "").trim();
  if (!target) return text;

  // ---------- helpers ----------
  const capSentenceWe = t =>
    t.replace(/(^|[.!?]\s+)(we)\b/g, (_, pre, we) => pre + "We");

  // ---------- MODE A: you -> WE/US/OUR/OURS/OURSELVES ----------
  if (target.toLowerCase() === "we") {
    const rules = [
      // contractions and auxiliaries
      { re: /\byou're\b/gi, repl: "we're" },
      { re: /\byou’ve\b/gi, repl: "we've" },
      { re: /\byou've\b/gi, repl: "we've" },
      { re: /\byou’ll\b/gi, repl: "we'll" },
      { re: /\byou'll\b/gi, repl: "we'll" },
      { re: /\byou’d\b/gi, repl: "we'd" },
      { re: /\byou'd\b/gi, repl: "we'd" },
      // verbs be/have in statements
      { re: /\byou are\b/gi, repl: "we are" },
      { re: /\byou were\b/gi, repl: "we were" },
      { re: /\byou have\b/gi, repl: "we have" },
      { re: /\byou had\b/gi, repl: "we had" },
      // common question forms: "are you", "did you", "will you", etc.
      { re: /\b(are|were|do|did|does|can|could|will|would|should|have|has|had)\s+you\b/gi, repl: "$1 we" },

      // reflexive
      { re: /\byourself\b/gi, repl: "ourselves" }, // single → plural is OK for party
      { re: /\byourselves\b/gi, repl: "ourselves" },

      // possessives
      { re: /\byours\b/gi, repl: "ours" },
      { re: /\byour\b/gi, repl: "our" },

      // object case with prepositions: "to you" → "to us", etc.
      { re: /\b(to|for|with|at|from|of|by|about|like|than|around|near|after|before|without|between|among|over|under|inside|outside|into|onto|upon|beside|behind|within)\s+you\b/gi, repl: "$1 us" },

      // fallback object-question form: "...you?" → "...us?" (rare)
      { re: /(\b)\?(\s*)you\b/gi, repl: "$1?$2us" },

      // plain "you" last (subject or remaining object) → "we"
      { re: /\byou\b/gi, repl: "we" },
    ];

    let out = rules.reduce((t, r) => t.replace(r.re, r.repl), text);
    out = capSentenceWe(out);
    return out;
  }

  // ---------- MODE B: you -> NAME (Johnny, Dain, etc.) ----------
  // Basic name-safe possessives and contractions; stays simple and predictable.
  const name = target;
  const nameRules = [
    // contractions / auxiliaries
    { re: /\byou’re\b/gi, repl: `${name}’s` },   // you're -> Johnny’s (is)
    { re: /\byou're\b/gi, repl: `${name}'s` },
    { re: /\byou’ve\b/gi, repl: `${name} has` },
    { re: /\byou've\b/gi, repl: `${name} has` },
    { re: /\byou’ll\b/gi, repl: `${name} will` },
    { re: /\byou'll\b/gi, repl: `${name} will` },
    { re: /\byou’d\b/gi, repl: `${name} would` },
    { re: /\byou'd\b/gi, repl: `${name} would` },
    // be/have/was-were
    { re: /\byou are\b/gi, repl: `${name} is` },
    { re: /\bare you\b/gi, repl: `is ${name}` }, // "are you..." → "is Johnny..."
    { re: /\byou were\b/gi, repl: `${name} was` },
    { re: /\bwere you\b/gi, repl: `was ${name}` },
    { re: /\byou have\b/gi, repl: `${name} has` },
    { re: /\bhave you\b/gi, repl: `has ${name}` },
    { re: /\byou had\b/gi, repl: `${name} had` },
    { re: /\bhad you\b/gi, repl: `had ${name}` },

    // reflexive / possessive
    { re: /\byourself\b/gi, repl: `${name}self` },
    { re: /\byours\b/gi, repl: `${name}'s` },
    { re: /\byour\b/gi, repl: `${name}'s` },

    // preposition + you → preposition + NAME (object)
    { re: /\b(to|for|with|at|from|of|by|about|like|than|around|near|after|before|without|between|among|over|under|inside|outside|into|onto|upon|beside|behind|within)\s+you\b/gi, repl: `$1 ${name}` },

    // remaining plain "you" → NAME
    { re: /\byou\b/gi, repl: name },
  ];

  return nameRules.reduce((t, r) => t.replace(r.re, r.repl), text);
}

async function refreshSessions(selectId = null) {
    try {
        const sessions = await getJSON("/api/sessions");
        const sel = document.getElementById("sessionSelect");
        if (!sel) return;

        const prev = selectId || sessionId || sel.value || "";
        sel.innerHTML =
            `<option value="">— Open previous session —</option>` +
            sessions.map(s => `<option value="${s.id}">${s.title}</option>`).join("");

        if (prev && sessions.some(s => s.id === prev)) {
            sel.value = prev;
        } else {
            sel.value = "";
        }
    } catch (e) {
        console.error("refreshSessions error:", e);
    }
}

async function refreshTranscriptsForSession(sid, pickId = null) {
    const tsel = document.getElementById("transcriptSelect");
    if (!tsel) return;
    if (!sid) {
        tsel.innerHTML = `<option value="">— Choose transcript —</option>`;
        return;
    }
    const list = await getJSON(`/api/sessions/${sid}/transcripts`);
    const prev = pickId || transcriptId || tsel.value || "";
    tsel.innerHTML = `<option value="">— Choose transcript —</option>` +
        list.map(t => `<option value="${t.id}">${t.fileName || t.id} — ${new Date(t.createdAt).toLocaleString()}</option>`).join("");
    if (prev && list.some(t => t.id === prev)) tsel.value = prev; else tsel.value = "";
}

let speakers = ["Narrator",  "Crudark", "Lift", "Johann", "Dain", "Truvik", "Inda","Celestian", "Speaker A", "Speaker B"];

// pagination/filter/search state
let pageSize = 200;
let offset = 0;
let total = 0;
let curItems = []; // current page from server

function speakerOptions(selected = "") {
    return ["", ...speakers].map(s =>
        `<option value="${s}" ${s === selected ? "selected" : ""}>${s || "(no speaker)"}</option>`
    ).join("");
}

function initPaintbar() {
  const sel = $("paintSpeaker");
  if (!sel) return;
  sel.innerHTML = speakerOptions("").replace('value="" selected','value=""'); // reuse
  $("paintClear").onclick = ()=>{ sel.value=""; document.body.classList.remove("painting"); };
  sel.onchange = ()=>{
    document.body.classList.toggle("painting", !!sel.value);
  };
}
initPaintbar();



bind("cleanCurrent", "click", async () => {
    if (!transcriptId) return status("No current transcript. Import first.");
    status("Cleaning current transcript…");
    const resp = await fetch(`/api/transcripts/${transcriptId}/cleanup`, { method: "POST" }).then(r => r.json());
    if (resp.error) return status(resp.error);
    status(`Cleaned: ${resp.updated} updated, ${resp.deleted} removed.`);
    loadPage(true);
});

bind("cleanByTitle", "click", async () => {
    const title = prompt("Enter session title to clean:");
    if (!title) return;
    status(`Cleaning "${title}"…`);
    const resp = await fetch(`/api/transcripts/cleanup/by-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
    }).then(r => r.json());

    if (resp.error) return status(resp.error);

    // update local state to the cleaned transcript
    sessionId = resp.sessionId || sessionId;     // if you return it; else leave as-is
    transcriptId = resp.transcriptId;
    localStorage.setItem("lastSessionId", sessionId || "");
    localStorage.setItem("lastTranscriptId", transcriptId || "");

    status(`Cleaned: ${resp.updated} updated, ${resp.deleted} removed.`);

    // 👇 repopulate dropdown and keep selection
    await refreshSessions(sessionId);

    // reload the current page
    await loadPage(true);
});

bind("exportChatGPT", "click", () => {
    if (!transcriptId) { status("Nothing open to export."); return; }
    const title = (document.getElementById("title")?.value || "Transcript").trim();
    // Optional fallback speaker label for unnamed lines (defaults to "Narrator")
    const url = `/api/export/transcript/${transcriptId}/novelize.txt?title=${encodeURIComponent(title)}&fallback=Narrator`;
    window.open(url, "_blank");
    status("Exporting…");
});


async function loadSessionsIntoPicker() {
    try {
        const sessions = await getJSON("/api/sessions"); // {id,title,date,...}
        const sel = document.getElementById("sessionSelect");
        if (!sel) return;
        sel.innerHTML = `<option value="">— Open previous session —</option>` +
            sessions.map(s => `<option value="${s.id}">${s.title}</option>`).join("");
        if (sessionId) sel.value = sessionId;
    } catch (e) {
        console.error(e);
    }
}
window.addEventListener("DOMContentLoaded", async () => {
    await refreshSessions();
    if (sessionId) await refreshTranscriptsForSession(sessionId);
    if (transcriptId) {
        await loadPage(true);
    } else if (sessionId) {
        try {
            const last = await getJSON(`/api/sessions/${sessionId}/last`);
            transcriptId = last.id;
            localStorage.setItem("lastTranscriptId", transcriptId);
            await loadPage(true);
        } catch { }
    }
});



// Group nearby tiny cues into paragraphs client-side (view only)
function groupify(items, maxChars = 320) {
  const out = []; let cur = null;
  for (const it of items) {
    const sameSpeaker = cur && cur.speakerName === (it.speakerName || "");
    const wouldExceed = cur && (cur.text.length + 1 + it.text.length) > maxChars;
    if (!cur || !sameSpeaker || wouldExceed) {
      if (cur) out.push(cur);
      cur = { ...it };                // ← keep id & speakerName
    } else {
      cur.text = (cur.text + " " + it.text).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}
const segFloat = document.getElementById("segCountFloat");
if (segFloat && !segFloat.dataset.bound) {
  segFloat.dataset.bound = "1";
  segFloat.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
function render(items) {
  const grouped = $("groupView").checked ? groupify(items) : items;

  $("segments").innerHTML = grouped.map(s => {
    const id = s.id;
    const speaker = s.speakerName || "";        // ← safe per-item
    const text = s.text || "";
    const noSpeakerClass = speaker ? "" : " no-speaker";

    return `
    <div class="seg${noSpeakerClass}" data-id="${id}">
      <header>
        <input type="checkbox" class="sel" name="select-${id}" />
        <button type="button" class="btn play" data-start="${s.startSec||0}" data-end="${s.endSec||0}">▶︎</button>
        <button type="button" class="btn you2name" title="Rewrite 'you' → paint speaker">You→Name</button>
        <button type="button" class="btn you2we"   title="Rewrite 'you' → we/us/our">You→We</button>

        <button type="button" class="btn ins-above" title="Insert above" name="above-${id}">+ Above</button>
        <button type="button" class="btn ins-below"  title="Insert below"  name="below-${id}">+ Below</button>
        <button type="button" class="btn merge-up"   title="Merge into previous" name="mergeup-${id}">Merge ↑</button>
        <span class="pill">${speaker || "—"}</span>
        <select class="speaker" name="speaker-${id}">${speakerOptions(speaker)}</select>
        <button type="button" class="btn copy" style="margin-left:auto;">Copy</button>
        <button type="button" class="btn del"  title="Delete segment" style="border-color:#5a1a1a;">Delete</button>
      </header>
      <textarea class="text" name="text-${id}">${text.replace(/</g,"&lt;")}</textarea>
    </div>
`;
  }).join("");
const player = $("player");
let isShiftDown = false;
document.addEventListener("keydown", e=>{ if(e.key==="Shift") isShiftDown = true; });
document.addEventListener("keyup",   e=>{ if(e.key==="Shift") isShiftDown = false; });

const paintSel = $("paintSpeaker");
if (paintSel) {
  $$(".seg").forEach(el=>{
    el.addEventListener("click", async (e)=>{
      if (!document.body.classList.contains("painting")) return;
      const speakerName = paintSel.value || null;
      const id = el.dataset.id;
      await save(id, { speakerName });
      const item = curItems.find(x=> String(x.id)===String(id));
      if (item) item.speakerName = speakerName;
      el.querySelector(".pill").textContent = speakerName || "—";
      el.classList.toggle("no-speaker", !speakerName);
      if (isShiftDown) {
        // move to next visible seg so you can quickly paint forward
        const next = el.nextElementSibling;
        if (next) next.scrollIntoView({block:"center"}), next.focus();
      }
    });
  });
}

// hook up per-card play
$$(".seg .btn.play").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const start = parseFloat(btn.dataset.start||"0");
    const end   = parseFloat(btn.dataset.end||"0");
    player.currentTime = start;
    player.play();
    player.dataset.segEnd = end; // remember where to stop
  });
});

// live highlight of the currently playing segment
player.addEventListener("timeupdate", ()=>{
  const t = player.currentTime;
  const end = parseFloat(player.dataset.segEnd||"0");
  $$(".seg").forEach(el=>{
    const s = parseFloat(el.dataset.start||"0");
    const e = parseFloat(el.dataset.end||"0");
    const active = t >= s && (e ? t < e : true);
    el.classList.toggle("playing", active);
    if (active) el.scrollIntoView({block:"center", behavior:"smooth"});
  });
  if (end && t > end) player.pause();
});

  // update shown/total count
  const shown = grouped.length;
  const countEl = document.getElementById("segCount");
  if (countEl) countEl.textContent = `(${shown} shown of ${total})`;
const label = `(${shown} shown of ${total})`;
if (countEl) countEl.textContent = label;

const segFloatNow = document.getElementById("segCountFloat");
if (segFloatNow) segFloatNow.textContent = `Segments ${label}`;
  // refresh pager
  updatePagerUI();

  // wire events per segment
  document.querySelectorAll(".seg").forEach((el) => {
    const id = el.dataset.id;

    // keep selected Set in sync with per-item checkbox
    const cb = el.querySelector(".sel");
    if (cb) {
      cb.addEventListener("change", (e) => {
        if (e.target.checked) selected.add(id);
        else selected.delete(id);
      });
    }

el.querySelector(".speaker").addEventListener("change", async (e) => {
  const speakerName = e.target.value || null;
  try {
    await save(id, { speakerName });                     // PUT /api/segments/:id
    // update local cache
    const item = curItems.find(x => String(x.id) === String(id));
    if (item) item.speakerName = speakerName;
    // update UI inline (no full rerender)
    el.querySelector(".pill").textContent = speakerName || "—";
    el.classList.toggle("no-speaker", !speakerName);     // card
    el.querySelector("header")?.classList.toggle("no-speaker", !speakerName); // header
  } catch (err) {
    console.error(err);
    status(String(err.message || err));                  // your existing status toaster, if present
    // revert dropdown to previous known value
    e.target.value = item?.speakerName || "";
  }
});


    el.querySelector(".copy").addEventListener("click", async (e) => {
      const btn = e.target;
      const textarea = el.querySelector(".text");
      const text = textarea.value;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          textarea.select();
          textarea.setSelectionRange(0, 99999);
          document.execCommand('copy');
          window.getSelection().removeAllRanges();
        }
        const original = btn.textContent;
        btn.textContent = "✓ Copied!";
        btn.style.background = "#1a4d1a";
        setTimeout(() => { btn.textContent = original; btn.style.background = ""; }, 1500);
      } catch (err) {
        status("Copy failed: " + err.message);
      }
    });
// inside render(...), where you wire per-segment events:
el.querySelector(".merge-up").addEventListener("click", async () => {
  const thisId = el.dataset.id;
  const idx = curItems.findIndex(x => x.id === thisId);
  if (idx <= 0) { status("Nothing above to merge into."); return; }

  const prev = curItems[idx - 1];
  const curr = curItems[idx];

  const prevText = (prev.text || "").trim();
  const currText = (curr.text || "").trim();
  const mergedText = (prevText + " " + currText).replace(/\s+/g, " ").trim();

  // 1) Update the previous segment's text
  const r1 = await fetch(`/api/segments/${prev.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: mergedText })
  });
  if (!r1.ok) { status("Merge failed while updating above segment."); return; }

  // keep local cache consistent
  prev.text = mergedText;

  // 2) Delete the current segment
  const r2 = await fetch(`/api/segments/${thisId}`, { method: "DELETE" });
  if (!r2.ok) { status("Merge failed while deleting current segment."); return; }

  // 3) Adjust counters/pagination like your single-delete flow
  total = Math.max(0, total - 1);
  const pages = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
  const newOffset = Math.min(offset, (pages - 1) * pageSize);
  if (newOffset !== offset) offset = newOffset;

  // 4) Reload this page and focus the merged-into segment’s textarea
  await loadPage(false, prev.id);
  const t = document.querySelector(`.seg[data-id="${prev.id}"] .text`);
  if (t) t.focus();

  status("Merged up.");
});

    el.querySelector(".del")?.addEventListener("click", async () => {
      const clickedId = el.dataset.id;
      const idx = curItems.findIndex(x => x.id === clickedId);
      const nextId = curItems[idx + 1]?.id || null;
      const prevId = idx > 0 ? curItems[idx - 1].id : null;
      const focusId = nextId || prevId || null;

      const r = await fetch(`/api/segments/${clickedId}`, { method: "DELETE" });
      if (!r.ok) { status("Delete failed."); return; }

      total = Math.max(0, total - 1);
      const pages = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
      const newOffset = Math.min(offset, (pages - 1) * pageSize);
      if (newOffset !== offset) offset = newOffset;

      await loadPage(false, focusId);
      if (focusId) {
        const t = document.querySelector(`.seg[data-id="${focusId}"] .text`);
        if (!t) {
          const first = document.querySelector(".seg .text");
          if (first) first.focus();
        }
      }
    });

    el.querySelector(".ins-above").addEventListener("click", () => openInlineComposer(el, "before"));
    el.querySelector(".ins-below").addEventListener("click", () => openInlineComposer(el, "after"));
  });
  // You→Name
$$(".seg .you2name").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const card = btn.closest(".seg");
    const id = card.dataset.id;
    const ta = card.querySelector("textarea.text");
    const who = $("paintSpeaker")?.value;
    if (!who) { status("Pick a name in Paint speaker first."); return; }
    const newText = fixAddressedTo(ta.value, who);
    ta.value = newText;
    await save(id, { text: newText });
    const item = curItems.find(x=> String(x.id) === String(id));
    if (item) item.text = newText;
  });
});

// You→We
$$(".seg .you2we").forEach(btn=>{
  btn.addEventListener("click", async ()=>{
    const card = btn.closest(".seg");
    const id = card.dataset.id;
    const ta = card.querySelector("textarea.text");
    const newText = fixAddressedTo(ta.value, "we");
    ta.value = newText;
    await save(id, { text: newText });
    const item = curItems.find(x=> String(x.id) === String(id));
    if (item) item.text = newText;
  });
});

}

async function save(id, patch) {
  const r = await fetch(`/api/segments/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!r.ok) {
    const msg = await r.text().catch(()=>r.statusText);
    throw new Error(`Save failed (${r.status}): ${msg}`);
  }
  return r.json().catch(()=> ({}));
}

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

    // Call the insert endpoint
    const resp = await fetch(`/api/segments/${id}/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ where, text, speakerName })
    });
    const seg = await resp.json();
    if (!resp.ok || seg.error) { status(seg.error || "Insert failed"); return; }

    // Keep count & reload current page; focus the new segment
    total = total + 1;
    await loadPage(false, seg.id); // loadPage(reset=false, focus the new one) :contentReference[oaicite:6]{index=6}
    status("Inserted.");
  });
}

function syncPageSizeSelects() {
  const top = document.getElementById("pageSize");
  const bot = document.getElementById("pageSizeBottom");
  if (top) top.value = String(pageSize);
  if (bot) bot.value = String(pageSize);
}

function updatePagerUI() {
  const pageNo = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const info = `Page ${pageNo} / ${pages}`;

  const setText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  setText("pageInfo", info);
  setText("pageInfoBottom", info);

  // Disable prev/next at edges
  const atStart = offset <= 0;
  const atEnd   = offset + pageSize >= total;

  const setDis = (id, dis) => { const el = document.getElementById(id); if (el) el.disabled = !!dis; };
  setDis("prevPage", atStart);
  setDis("nextPage", atEnd);
  setDis("prevPageBottom", atStart);
  setDis("nextPageBottom", atEnd);

  syncPageSizeSelects();
}
function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }
// After loadPage(true) or loadPage() completes, you can call scrollToTop();
// or only do it inside the bottom Next/Prev handlers if you prefer.

async function loadPage(reset = false, focusId = null) {
  if (!transcriptId) { total = 0; curItems = []; render(curItems); return; }
  if (reset) offset = 0;

  const speaker = $("speakerFilter")?.value || "";
  const q = $("search")?.value || "";

  const url = new URL(`/api/transcripts/${transcriptId}/segments`, window.location.origin);
  url.searchParams.set("limit", pageSize);
  url.searchParams.set("offset", offset);
  if (speaker) url.searchParams.set("speaker", speaker);
  if (q) url.searchParams.set("q", q);

  const resp = await fetch(url, { cache: "no-store" }).then(r => r.json());
  total = resp.total;
  curItems = resp.items;
  render(curItems);

  if (focusId) {
    const nextEl = document.querySelector(`.seg[data-id="${focusId}"] .text`);
    if (nextEl) nextEl.focus();
  }
}



// UI hooks
bind("prevPage", "click", () => { offset = Math.max(0, offset - pageSize); loadPage(); });
bind("nextPage", "click", () => { offset = Math.min(Math.max(0, total - pageSize), offset + pageSize); loadPage(); });
bind("pageSize", "change", (e) => { pageSize = parseInt(e.target.value, 10) || 200; loadPage(true); });
bind("speakerFilter", "change", () => loadPage(true));
bind("groupView", "change", () => render(curItems));
let t = null;
bind("search", "input", () => { clearTimeout(t); t = setTimeout(() => loadPage(true), 300); });
$("copySpeaker").addEventListener("click", async ()=> {
  const speaker = $("speakerFilter").value || "";
  if (!speaker) return status("Pick a speaker to copy.");
  const text = curItems.filter(s => (s.speakerName||"")===speaker).map(s=>s.text).join("\n\n");
  if (!text) return status("No items on this page for that speaker.");
  
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // Create temporary textarea for fallback
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    status(`Copied ${speaker} (current page).`);
  } catch (err) {
    status("Copy failed: " + err.message);
  }
});
// Top pager page size (existing handler) — ensure it also syncs:
bind("pageSize", "change", (e) => {
  pageSize = parseInt(e.target.value, 10) || 200;
  syncPageSizeSelects();
  loadPage(true);
});
// Bottom pager: Prev / Next
bind("prevPageBottom", "click", () => {
  offset = Math.max(0, offset - pageSize);
  loadPage();
});

bind("topPageBottom", "click", () => {
    loadPage();
    scrollToTop();
});
bind("nextPageBottom", "click", () => {
  offset = Math.min(Math.max(0, total - pageSize), offset + pageSize);
  loadPage();
});
// Bottom pager: Page size select (kept in sync with top)
bind("pageSizeBottom", "change", (e) => {
  pageSize = parseInt(e.target.value, 10) || 200;
  syncPageSizeSelects();
  loadPage(true);
});
// Select-all (page) checkbox
bind("selectAll", "change", (e) => {
  const check = !!e.target.checked;
  document.querySelectorAll(".seg .sel").forEach(cb => {
    cb.checked = check;
    const id = cb.closest(".seg").dataset.id;
    if (check) selected.add(id); else selected.delete(id);
  });
});

// Bulk delete button
bind("bulkDelete", "click", async () => {
  if (selected.size === 0) { status("No segments selected."); return; }
  if (!confirm(`Delete ${selected.size} selected segment(s)?`)) return;

  // call your existing API
  const resp = await fetch("/api/segments/bulk-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentIds: Array.from(selected) })
  }).then(r => r.json());

  if (resp.error) return status(resp.error);

  // adjust total + reload this page (like your single-delete flow)
  total = Math.max(0, total - resp.count);
  const pages = Math.max(1, Math.ceil(Math.max(1, total) / pageSize));
  const newOffset = Math.min(offset, (pages - 1) * pageSize);
  if (newOffset !== offset) offset = newOffset;

  selected.clear();
  const selAll = document.getElementById("selectAll");
  if (selAll) selAll.checked = false;

  await loadPage(false);
  status(`Deleted ${resp.count} segment(s).`);
});
bind("markMatches", "click", () => {
  const q = (document.getElementById("markPattern")?.value || "").trim();
  if (!q) return;
  const needle = q.toLowerCase();
  let hits = 0;
  document.querySelectorAll(".seg").forEach(el => {
    const txt = el.querySelector(".text")?.value?.toLowerCase() || "";
    if (txt.includes(needle)) {
      const cb = el.querySelector(".sel");
      if (cb && !cb.checked) { cb.checked = true; hits++; }
      selected.add(el.dataset.id);
    }
  });
  status(`Marked ${hits} segment(s) containing "${q}".`);
});

// import handlers (same as before)
$("btnImportText").addEventListener("click", async () => {
    const resp = await fetch("/api/import", { /* … */ }).then(r => r.json());
    if (resp.error) return status(resp.error);
    sessionId = resp.session.id;           // ← add this
    transcriptId = resp.transcript.id;        // already present
    localStorage.setItem("lastSessionId", sessionId);
    localStorage.setItem("lastTranscriptId", transcriptId);
    status(`Imported ${resp.segmentsCreated} segments into “${resp.session.title}”.`);
    $("raw").value = "";
    loadPage(true);
});

$("file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const title = $("title").value.trim();
    if (!title) return status("Please enter a Session Title.");
    status(`Uploading ${f.name}…`);
    const fd = new FormData();
    fd.append("title", title);
    fd.append("file", f);
    const resp = await fetch("/api/import", { method: "POST", body: fd }).then(r => r.json());
    if (resp.error) return status(resp.error);
    transcriptId = resp.transcript.id;
    sessionId = resp.session.id;
    localStorage.setItem("lastSessionId", sessionId);
    localStorage.setItem("lastTranscriptId", transcriptId);
    status(`Imported ${resp.segmentsCreated} from ${f.name} into “${resp.session.title}”.`);
    e.target.value = "";
    loadPage(true);
});

// init speaker filter
$("speakerFilter").innerHTML = `<option value="">All speakers</option>` + speakers.map(s => `<option value="${s}">${s}</option>`).join("");

bind("sessionSelect", "change", async () => {
    const sid = document.getElementById("sessionSelect")?.value || "";
    await refreshTranscriptsForSession(sid);
    if (!sid) return;
    try {
        const last = await getJSON(`/api/sessions/${sid}/last`);
        sessionId = sid;
        transcriptId = last.id;
        localStorage.setItem("lastSessionId", sessionId);
        localStorage.setItem("lastTranscriptId", transcriptId);
        await loadPage(true);
    } catch {
        transcriptId = null;
        localStorage.removeItem("lastTranscriptId");
        total = 0; curItems = []; render(curItems);
    }
});

bind("openSession", "click", async () => {
    const sel = document.getElementById("sessionSelect");
    const chosen = sel?.value || "";
    if (!chosen) { status("Pick a session to open."); return; }
    try {
        const last = await getJSON(`/api/sessions/${chosen}/last`);
        sessionId = chosen;
        transcriptId = last.id;
        localStorage.setItem("lastSessionId", sessionId);
        localStorage.setItem("lastTranscriptId", transcriptId);
        status(`Opened: ${sel.options[sel.selectedIndex].text}`);
        offset = 0; // reset pagination
        await loadPage(true);
    } catch (e) {
        status("That session has no transcripts yet.");
    }
});
bind("cleanSelected", "click", async () => {
    const tid = document.getElementById("transcriptSelect")?.value || "";
    if (!tid) return status("Pick a transcript to clean.");
    status("Cleaning selected transcript…");
    const resp = await fetch(`/api/transcripts/${tid}/cleanup`, { method: "POST" }).then(r => r.json());
    if (resp.error) return status(resp.error);
    status(`Cleaned: ${resp.updated} updated, ${resp.deleted} removed.`);
    // adopt it as current, reload, and keep dropdowns in sync
    transcriptId = tid;
    localStorage.setItem("lastTranscriptId", transcriptId);
    await loadPage(true);
});

// Delete the *selected transcript* explicitly (with confirm)
bind("deleteSelected", "click", async () => {
    const tid = document.getElementById("transcriptSelect")?.value || "";
    if (!tid) return status("Pick a transcript to delete.");
    if (!confirm("Delete this transcript (all its segments)?")) return;
    status("Deleting transcript…");
    await fetch(`/api/transcripts/${tid}`, { method: "DELETE" });
    // If we deleted the current one, clear state
    if (transcriptId === tid) {
        transcriptId = null; localStorage.removeItem("lastTranscriptId");
        total = 0; curItems = []; render(curItems);
    }
    // Refresh transcript dropdown for the current session
    const sid = document.getElementById("sessionSelect")?.value || sessionId || "";
    await refreshTranscriptsForSession(sid);
    status("Transcript deleted.");
});

bind("openLatest", "click", async () => {
    try {
        const t = await getJSON("/api/resume"); // latest across all sessions
        sessionId = t.sessionId;
        transcriptId = t.id;
        localStorage.setItem("lastSessionId", sessionId);
        localStorage.setItem("lastTranscriptId", transcriptId);
        const sel = document.getElementById("sessionSelect");
        if (sel) sel.value = sessionId;
        status(`Opened latest: ${t.session?.title || t.id}`);
        offset = 0;
        await loadPage(true);
    } catch (e) {
        status("No transcripts found.");
    }
});

(function initAddressTools(){
  const who = $("addressWho");
  if (!who) return;
  who.innerHTML = speakerOptions("").replace('value="" selected','value=""');

  $("addressApply").onclick = async ()=>{
    const name = who.value;
    if (!name) return;
    const targets = [...$$(".seg.in-range")];
    if (targets.length===0) return;

    // pull, rewrite, save each selected card’s text
    for (const el of targets) {
      const id = el.dataset.id;
      const ta = el.querySelector("textarea.text");
      const newText = fixAddressedTo(ta.value, name);
      ta.value = newText;
      await save(id, { text: newText });
      const item = curItems.find(x=> String(x.id)===String(id));
      if (item) item.text = newText;
    }

    targets.forEach(el=> el.classList.remove("in-range"));
  };
})();
document.addEventListener("keydown", (e)=>{
  const playing = $(".seg.playing") || $(".seg:focus") || $(".seg");
  if (!playing) return;
  if (e.key==="j") playing.nextElementSibling?.scrollIntoView({block:"center"});
  if (e.key==="k") playing.previousElementSibling?.scrollIntoView({block:"center"});
  if (e.key.toLowerCase()==="s") $("player")?.paused ? $("player").play() : $("player").pause();
  if (e.key.toLowerCase()==="a") playing.querySelector(".speaker")?.focus();
});
