import React, { useEffect, useMemo, useRef, useState } from "react";

// MVP React app to label/edit transcripts quickly.
// Features:
// - Load SRT/VTT/TXT
// - Parse into segments {id, start, end, text}
// - Assign speakers (quick buttons), add ad-hoc speakers
// - Edit text inline
// - Copy segment text or all text by speaker
// - Export JSON / Markdown / SRT
// - Local autosave
//
// Styling: Tailwind (assumed available). Minimal, clean, keyboard-friendly.
// Keyboard: [1..9] assign speaker, Ctrl+B copy segment, Ctrl+S save, Ctrl+E merge next.

export default function App() {
  // ---- Types ----
  type Segment = {
    id: string;
    start?: number; // seconds
    end?: number; // seconds
    text: string;
    speaker?: string; // neutral or chosen
  };

  type Speaker = {
    name: string;
    pinned?: boolean; // main/recurring characters
    color?: string; // tag color
  };

  // ---- State ----
  const [segments, setSegments] = useState<Segment[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([
    { name: "Narrator", pinned: true },
    { name: "DM", pinned: true },
    { name: "Crudark", pinned: true },
    { name: "Lift", pinned: true },
    { name: "Johann", pinned: true },
    { name: "Dain", pinned: true },
    { name: "Truvik", pinned: true },
    { name: "Speaker A" },
    { name: "Speaker B" },
  ]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filterSpeaker, setFilterSpeaker] = useState<string>("");
  const [showTimes, setShowTimes] = useState(true);
  const [fileName, setFileName] = useState<string>("(unsaved)");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // ---- Helpers ----
  const now = () => new Date().toISOString();

  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function pad(n: number) {
    return String(n).padStart(2, "0");
  }

  function secToSrtTime(sec?: number) {
    if (sec == null) return "00:00:00,000";
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    const ms = Math.floor((s - Math.floor(s)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(ss)},${String(ms).padStart(3, "0")}`;
  }

  function parseTimeToSec(ts: string): number | undefined {
    // Accept 00:00:00,000 or 00:00:00.000
    const m = ts.match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!m) return undefined;
    const [_, hh, mm, ss, ms] = m;
    return (
      parseInt(hh, 10) * 3600 +
      parseInt(mm, 10) * 60 +
      parseInt(ss, 10) +
      parseInt(ms, 10) / 1000
    );
  }

  function parseSRT(text: string): Segment[] {
    const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
    const segs: Segment[] = [];
    for (const b of blocks) {
      const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      let i = 0;
      if (/^\d+$/.test(lines[0])) i = 1;
      const timeLine = lines[i] || "";
      const m = timeLine.match(
        /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/
      );
      let start: number | undefined;
      let end: number | undefined;
      if (m) {
        start = parseTimeToSec(m[1]!);
        end = parseTimeToSec(m[2]!);
      }
      const content = lines.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").trim();
      if (!content) continue;
      segs.push({ id: uid(), start, end, text: content });
    }
    return segs;
  }

  function parseVTT(text: string): Segment[] {
    const cleaned = text.replace(/\r/g, "");
    const cueRe = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*\n([\s\S]*?)(?=\n\n|$)/g;
    const segs: Segment[] = [];
    let m: RegExpExecArray | null;
    while ((m = cueRe.exec(cleaned))) {
      const start = parseTimeToSec(m[1]!);
      const end = parseTimeToSec(m[2]!);
      const content = (m[3] || "").replace(/<[^>]+>/g, "").replace(/\n/g, " ").trim();
      if (content) segs.push({ id: uid(), start, end, text: content });
    }
    return segs;
  }

  function parseTXT(text: string): Segment[] {
    // Split on blank lines; create segments without time.
    const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
    return blocks
      .map((b) => b.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .map((t) => ({ id: uid(), text: t }));
  }

  // ---- File handling ----
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const tx = String(reader.result || "");
      let segs: Segment[] = [];
      if (f.name.toLowerCase().endsWith(".srt")) segs = parseSRT(tx);
      else if (f.name.toLowerCase().endsWith(".vtt")) segs = parseVTT(tx);
      else segs = parseTXT(tx);
      setSegments(segs);
      setFileName(f.name);
      setSelectedIndex(0);
    };
    reader.readAsText(f);
  }

  // ---- Autosave to localStorage ----
  useEffect(() => {
    const payload = JSON.stringify({ segments, speakers, fileName });
    localStorage.setItem("transcript_mvp_autosave", payload);
    setLastSavedAt(Date.now());
  }, [segments, speakers, fileName]);

  useEffect(() => {
    const saved = localStorage.getItem("transcript_mvp_autosave");
    if (saved) {
      try {
        const { segments: s, speakers: sp, fileName: fn } = JSON.parse(saved);
        if (s?.length) setSegments(s);
        if (sp?.length) setSpeakers(sp);
        if (fn) setFileName(fn);
      } catch {}
    }
  }, []);

  // ---- Editing ----
  function updateSegment(idx: number, patch: Partial<Segment>) {
    setSegments((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function assignSpeaker(idx: number, name: string) {
    updateSegment(idx, { speaker: name });
  }

  function addSpeaker(name: string, pinned = false) {
    name = name.trim();
    if (!name) return;
    if (speakers.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    setSpeakers((prev) => [...prev, { name, pinned }]);
  }

  function togglePinned(name: string) {
    setSpeakers((prev) =>
      prev.map((s) => (s.name === name ? { ...s, pinned: !s.pinned } : s))
    );
  }

  function mergeWithNext(idx: number) {
    if (idx < 0 || idx >= segments.length - 1) return;
    const cur = segments[idx];
    const nxt = segments[idx + 1];
    const merged: Segment = {
      id: uid(),
      start: cur.start,
      end: nxt.end ?? cur.end,
      text: `${cur.text} ${nxt.text}`.replace(/\s+/g, " ").trim(),
      speaker: cur.speaker ?? nxt.speaker,
    };
    setSegments((prev) => [
      ...prev.slice(0, idx),
      merged,
      ...prev.slice(idx + 2),
    ]);
    setSelectedIndex(idx);
  }

  function splitAtSelection(idx: number, position: number) {
    const seg = segments[idx];
    const t = seg.text;
    const a = t.slice(0, position).trim();
    const b = t.slice(position).trim();
    if (!a || !b) return;
    const mid = seg.start && seg.end ? (seg.start + seg.end) / 2 : undefined;
    const left: Segment = { id: uid(), start: seg.start, end: mid, text: a, speaker: seg.speaker };
    const right: Segment = { id: uid(), start: mid, end: seg.end, text: b, speaker: seg.speaker };
    setSegments((prev) => [
      ...prev.slice(0, idx),
      left,
      right,
      ...prev.slice(idx + 1),
    ]);
  }

  function copySegment(idx: number) {
    const seg = segments[idx];
    navigator.clipboard.writeText(seg.text);
  }

  function copyAllOfSpeaker(name: string) {
    const text = segments
      .filter((s) => s.speaker === name)
      .map((s) => s.text)
      .join("\n\n");
    if (text) navigator.clipboard.writeText(text);
  }

  // ---- Exporters ----
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ fileName, speakers, segments }, null, 2)], {
      type: "application/json",
    });
    triggerDownload(blob, `${fileName.replace(/\.[^.]+$/, "")}_labeled.json`);
  }

  function exportMarkdown() {
    const byTime = segments
      .map((s, i) => {
        const head = showTimes ? `[${secToSrtTime(s.start)}] ` : "";
        const sp = s.speaker ? `**${s.speaker}:** ` : "";
        return `- ${head}${sp}${s.text}`;
      })
      .join("\n");
    const blob = new Blob([
      `# Labeled Transcript (exported ${now()})\n\n${byTime}\n`,
    ], { type: "text/markdown" });
    triggerDownload(blob, `${fileName.replace(/\.[^.]+$/, "")}_labeled.md`);
  }

  function exportSRT() {
    const lines: string[] = [];
    segments.forEach((s, i) => {
      lines.push(String(i + 1));
      const a = secToSrtTime(s.start);
      const b = secToSrtTime(s.end ?? (s.start ? s.start + 3 : undefined));
      lines.push(`${a} --> ${b}`);
      const text = `${s.speaker ? s.speaker + ": " : ""}${s.text}`;
      lines.push(text);
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    triggerDownload(blob, `${fileName.replace(/\.[^.]+$/, "")}_labeled.srt`);
  }

  function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        copySegment(selectedIndex);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        // autosave already happens; show a tiny visual cue
        setLastSavedAt(Date.now());
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        mergeWithNext(selectedIndex);
      }
      // number keys 1..9 assign pinned speakers in order
      if (!e.ctrlKey && !e.metaKey) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 9) {
          const pinnedList = speakers.filter((s) => s.pinned);
          const sp = pinnedList[n - 1];
          if (sp) assignSpeaker(selectedIndex, sp.name);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIndex, speakers, segments]);

  // ---- Derived ----
  const visibleSegments = useMemo(() => {
    if (!filterSpeaker) return segments;
    return segments.filter((s) => (s.speaker || "") === filterSpeaker);
  }, [segments, filterSpeaker]);

  const pinnedSpeakers = speakers.filter((s) => s.pinned);
  const otherSpeakers = speakers.filter((s) => !s.pinned);

  // ---- UI ----
  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold">Transcript Labeler</h1>
          <span className="text-sm text-neutral-400">{fileName}</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="cursor-pointer rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800">
              Load SRT/VTT/TXT
              <input type="file" accept=".srt,.vtt,.txt,.md" className="hidden" onChange={onFile} />
            </label>
            <button className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800" onClick={exportJSON}>Export JSON</button>
            <button className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800" onClick={exportMarkdown}>Export MD</button>
            <button className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800" onClick={exportSRT}>Export SRT</button>
            <label className="flex items-center gap-2 text-sm ml-3">
              <input type="checkbox" checked={showTimes} onChange={(e) => setShowTimes(e.target.checked)} />
              Show times
            </label>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-4 px-4 py-4">
        {/* Sidebar: Speakers */}
        <aside className="col-span-3 rounded-2xl border border-neutral-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Speakers</h2>
            {lastSavedAt && (
              <span className="text-xs text-neutral-500">autosaved {new Date(lastSavedAt).toLocaleTimeString()}</span>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs uppercase text-neutral-400">Pinned (1–9 to assign)</div>
              <div className="flex flex-wrap gap-2">
                {pinnedSpeakers.map((sp, i) => (
                  <button
                    key={sp.name}
                    title={`Assign ${sp.name} [${i + 1}]`}
                    onClick={() => assignSpeaker(selectedIndex, sp.name)}
                    className="rounded-full border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
                  >
                    {sp.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs uppercase text-neutral-400">Others</div>
              <div className="flex flex-wrap gap-2">
                {otherSpeakers.map((sp) => (
                  <div key={sp.name} className="flex items-center gap-2">
                    <button
                      onClick={() => assignSpeaker(selectedIndex, sp.name)}
                      className="rounded-full border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
                    >
                      {sp.name}
                    </button>
                    <button
                      title={sp.pinned ? "Unpin" : "Pin"}
                      onClick={() => togglePinned(sp.name)}
                      className="rounded-full border border-neutral-800 px-2 text-xs hover:bg-neutral-800"
                    >
                      {sp.pinned ? "★" : "☆"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <input id="add-speaker" placeholder="Add speaker…" className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-neutral-600" onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addSpeaker((e.target as HTMLInputElement).value, false);
                  (e.target as HTMLInputElement).value = "";
                }
              }} />
              <button className="rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800" onClick={() => {
                const el = document.getElementById("add-speaker") as HTMLInputElement | null;
                if (el && el.value.trim()) { addSpeaker(el.value, false); el.value = ""; }
              }}>Add</button>
            </div>

            <div className="mt-2">
              <div className="mb-1 text-xs uppercase text-neutral-400">Filter</div>
              <select value={filterSpeaker} onChange={(e) => setFilterSpeaker(e.target.value)} className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm">
                <option value="">All speakers</option>
                {speakers.map((s) => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </select>
              {filterSpeaker && (
                <button onClick={() => copyAllOfSpeaker(filterSpeaker)} className="mt-2 w-full rounded border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">
                  Copy all of {filterSpeaker}
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Main: Segments */}
        <main className="col-span-9 space-y-3">
          {visibleSegments.length === 0 && (
            <div className="rounded-2xl border border-neutral-800 p-6 text-neutral-400">
              Load a transcript (SRT/VTT/TXT) to begin.
            </div>
          )}

          {visibleSegments.map((seg, i) => {
            const idx = filterSpeaker ? segments.findIndex((s) => s.id === seg.id) : i;
            const isSelected = idx === selectedIndex;
            return (
              <div key={seg.id} onClick={() => setSelectedIndex(idx)} className={`rounded-2xl border ${isSelected ? "border-emerald-500" : "border-neutral-800"} bg-neutral-900 p-3 transition-colors`}>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-neutral-400 w-28">
                    {showTimes ? (
                      <div>
                        <div>{secToSrtTime(seg.start)}</div>
                        <div>→ {secToSrtTime(seg.end)}</div>
                      </div>
                    ) : (
                      <span>#{idx + 1}</span>
                    )}
                  </div>

                  <select value={seg.speaker || ""} onChange={(e) => assignSpeaker(idx, e.target.value)} className="min-w-40 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm">
                    <option value="">(no speaker)</option>
                    {speakers.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>

                  <div className="ml-auto flex items-center gap-2">
                    <button title="Copy segment (Ctrl+B)" onClick={() => copySegment(idx)} className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800">Copy</button>
                    <button title="Merge with next (Ctrl+E)" onClick={() => mergeWithNext(idx)} className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800">Merge →</button>
                  </div>
                </div>

                <textarea value={seg.text} onChange={(e) => updateSegment(idx, { text: e.target.value })} className="mt-2 h-28 w-full resize-y rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm outline-none focus:ring-1 focus:ring-neutral-600" />

                {/* Quick pins */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {pinnedSpeakers.map((sp, pIdx) => (
                    <button key={sp.name} onClick={() => assignSpeaker(idx, sp.name)} className="rounded-full border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800" title={`Assign ${sp.name} [${pIdx + 1}]`}>
                      {sp.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </main>
      </div>

      <footer className="border-t border-neutral-800 px-4 py-3 text-center text-xs text-neutral-500">
        <div className="mx-auto max-w-7xl">
          Tip: 1–9 assigns pinned speakers • Ctrl+B copy segment • Ctrl+E merge • Ctrl+S autosave • Click a card to select
        </div>
      </footer>
    </div>
  );
}
