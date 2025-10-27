import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() });

// tiny helpers
function splitTxt(text) {
  return text.replace(/\r/g, "")
    .split(/\n\s*\n/)                // blank line = new segment
    .map(t => t.replace(/\s+/g," ").trim())
    .filter(Boolean);
}
function parseTimed(text) {
  const src = text.replace(/\r/g, "");
  const blocks = src.split(/\n\s*\n/);
  const segs = [];

  // time token: HH:MM:SS.mmm | M:SS.mmm | S.mmm
  const timeToken = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{3})?|\\d+(?:[.,]\\d{3})';
  const timeRange = new RegExp(`^\\s*(${timeToken})\\s*-->\\s*(${timeToken})\\s*(.*)$`, "i");

  for (const b of blocks) {
    const lines = b.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.length === 1 && /^WEBVTT$/i.test(lines[0])) continue; // skip header

    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;          // numeric cue index

    let carry = "";
    const m = timeRange.exec(lines[i] || "");
    if (m) { carry = m[3] ? m[3].trim() : ""; i += 1; }

    const content = [carry, ...lines.slice(i)]
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (content) segs.push(content);
  }
  return segs;
}

// upsert session by title
async function getOrCreateSession({ title, date, notes, prisma }) {
  const found = await prisma.session.findFirst({ where: { title } });
  if (found) return found;
  return prisma.session.create({
    data: { title, date: date ? new Date(date) : undefined, notes: notes || "" }
  });
}
const prisma = new PrismaClient();
const app = express();

app.post("/api/import", upload.single("file"), async (req, res) => {
  try {
    const title = (req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "title is required" });

    const session = await getOrCreateSession({ title, date: req.body?.date, notes: req.body?.notes, prisma });

    let text = "";
    let fileName = req.body?.fileName || "uploaded.txt";
    if (req.file) {
      fileName = req.file.originalname || fileName;
      text = req.file.buffer.toString("utf8");
    } else {
      text = req.body?.text || "";
    }
    if (!text.trim()) return res.status(400).json({ error: "empty transcript" });

    const looksTimed =
      /^WEBVTT/m.test(text) ||
      /\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(text) ||
      /\b\d+[.,]\d{3}\s*-->\s*\d+[.,]\d{3}/.test(text); // short VTT times

    const segments = looksTimed ? parseTimed(text) : splitTxt(text);

    const transcript = await prisma.transcript.create({
      data: { sessionId: session.id, fileName }
    });

    if (segments.length) {
      await prisma.$transaction(async (tx) => {
        for (const t of segments) {
          await tx.segment.create({ data: { transcriptId: transcript.id, text: t } });
        }
      });
    }

    res.json({ session, transcript, segmentsCreated: segments.length });
  } catch (err) {
    console.error("IMPORT_ERROR:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});




app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/api/health", (req, res) => res.json({ ok: true }));


/**
 * POST /api/import
 * Accepts:
 *  - JSON: { title, date?, notes?, text }    // paste raw transcript text
 *  - or multipart/form-data: title, file     // upload .srt/.vtt/.txt
 * Behavior:
 *  - upsert session by title
 *  - create transcript, split into segments
 * Returns { session, transcript, segmentsCreated }
 */

app.post("/api/import", upload.single("file"), async (req, res) => {
  const isMultipart = !!req.file;
  const title = isMultipart ? req.body.title : req.body.title;
  if (!title) return res.status(400).json({ error: "title is required" });

  const date  = isMultipart ? req.body.date  : req.body.date;
  const notes = isMultipart ? req.body.notes : req.body.notes;

  const session = await getOrCreateSession({ title, date, notes });

  // Load text from body or file
  let text = "";
  let fileName = "uploaded.txt";
  if (isMultipart) {
    fileName = req.file?.originalname || fileName;
    text = Buffer.from(req.file.buffer).toString("utf8");
  } else {
    fileName = req.body.fileName || fileName;
    text = req.body.text || "";
  }
  if (!text.trim()) return res.status(400).json({ error: "empty transcript" });

  // naive SRT/VTT detection and splitting// inside /api/import
const srtTimeLine =
  /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;
const isVTT = /^WEBVTT/m.test(text);
// Decide parser
const looksTimed =
  /^WEBVTT/m.test(text) ||
  /\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(text) ||
  /\b\d+[.,]\d{3}\s*-->\s*\d+[.,]\d{3}/.test(text); // e.g., 2.640 --> 7.120

// Build text-only segments (no times)
let rows = [];
if (looksTimed) {
  const src = text.replace(/\r/g, "");
  const blocks = src.split(/\n\s*\n/);

  // time token: HH:MM:SS.mmm | M:SS.mmm | S.mmm
  const timeToken = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{3})?|\d+(?:[.,]\d{3})`;
  const timeRange = new RegExp(
    `^\\s*(${timeToken})\\s*-->\\s*(${timeToken})\\s*(.*)$`, "i"
  );

  for (const b of blocks) {
    const lines = b.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Skip global header like "WEBVTT"
    if (lines.length === 1 && /^WEBVTT$/i.test(lines[0])) continue;

    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1;           // drop numeric cue index

    // If first payload line is a time range...
    let carry = "";
    const m = timeRange.exec(lines[i] || "");
    if (m) { carry = m[3] ? m[3].trim() : ""; i += 1; }

    const content = [carry, ...lines.slice(i)]
      .join(" ")
      .replace(/<[^>]+>/g, "")    // strip tags
      .replace(/\s+/g, " ")
      .trim();

    if (content) rows.push({ text: content });
  }
} else {
  // TXT mode: blank line = new segment
  rows = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map(t => ({ text: t.replace(/\s+/g, " ").trim() }))
    .filter(r => r.text);
}




if (looksTimed) {
  // Collapse each cue to plain text only
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split("\n").map(x => x.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Skip index line if present
    let i = /^\d+$/.test(lines[0]) ? 1 : 0;

    // If line i is a time range, drop it; keep content lines
    if (srtTimeLine.test(lines[i] || "")) i += 1;

    // Join remaining lines as one segment, strip HTML tags
    const content = lines.slice(i).join(" ").replace(/<[^>]+>/g, "").trim();
    if (content) rows.push({ text: content });
  }
} else {
  // TXT mode: split on blank lines
  rows = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map(t => ({ text: t.replace(/\s+/g, " ").trim() }))
    .filter(r => r.text);
}

// Create transcript + segments (no times saved)
const transcript = await prisma.transcript.create({
  data: { sessionId: session.id, fileName }
});

if (rows.length) {
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.segment.create({
        data: {
          transcriptId: transcript.id,
          text: r.text,
          // no startSec/endSec at all
        }
      });
    }
  });
}

res.json({ session, transcript, segmentsCreated: rows.length });
});
// GET /api/transcripts/:id/segments?limit=200&offset=0&speaker=&q=
app.get("/api/transcripts/:id/segments", async (req, res) => {
  const id = req.params.id;
  const limit  = Math.min(parseInt(req.query.limit) || 200, 1000);
  const offset = parseInt(req.query.offset) || 0;
  const speaker = (req.query.speaker || "").trim();
  const q = (req.query.q || "").trim();

  const where = { transcriptId: id };
  if (speaker) where.speakerName = speaker;
  if (q) where.text = { contains: q, mode: "insensitive" };

const [items, total] = await Promise.all([
  prisma.segment.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], // ← stable order
    skip: offset,
    take: limit,
    select: { id: true, text: true, speakerName: true }
  }),
  prisma.segment.count({ where })
]);

  res.set("Cache-Control", "no-store");
  res.json({ total, items, limit, offset });
});

// Sessions
app.get("/api/sessions", async (req, res) => {
  const data = await prisma.session.findMany({ orderBy: { date: "desc" } });
  res.set("Cache-Control", "no-store");
  res.json(data);
});

app.post("/api/sessions", async (req, res) => {
  const Body = z.object({
    title: z.string().min(1),
    date: z.string().optional(),
    notes: z.string().optional()
  });
  const b = Body.parse(req.body);
  const session = await prisma.session.create({
    data: { title: b.title, date: b.date ? new Date(b.date) : undefined, notes: b.notes || "" }
  });
  res.json(session);
});

// Speakers
app.get("/api/speakers", async (req, res) => {
  const list = await prisma.speaker.findMany({ orderBy: { name: "asc" } });
  res.json(list);
});

app.post("/api/speakers", async (req, res) => {
  const Body = z.object({ name: z.string().min(1), pinned: z.boolean().optional(), color: z.string().optional() });
  const b = Body.parse(req.body);
  const s = await prisma.speaker.upsert({
    where: { name: b.name },
    update: { pinned: !!b.pinned, color: b.color },
    create: { name: b.name, pinned: !!b.pinned, color: b.color }
  });
  res.json(s);
});

// Transcripts (import text or upload file)
app.post("/api/transcripts", upload.single("file"), async (req, res) => {
  const Body = z.object({
    sessionId: z.string().min(1),
    fileName: z.string().optional(),
    text: z.string().optional()
  });
  const b = Body.parse({ ...req.body, fileName: req.body.fileName || req.file?.originalname });
  const transcript = await prisma.transcript.create({
    data: { sessionId: b.sessionId, fileName: b.fileName || "uploaded.txt" }
  });

  const text = req.file ? req.file.buffer.toString("utf8") : (b.text || "");
  const chunks = text.split(/\n\s*\n/).map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (chunks.length) {
    await prisma.segment.createMany({
      data: chunks.map(t => ({ transcriptId: transcript.id, text: t }))
    });
  }
  res.json({ transcript, segmentsCreated: chunks.length });
});



// meta (optional): min/max time for this transcript
app.get("/api/transcripts/:id/meta", async (req, res) => {
  const id = req.params.id;
  const [minStart] = await prisma.$queryRawUnsafe(
    `SELECT MIN("startSec") as m FROM "Segment" WHERE "transcriptId" = $1`, id
  );
  const [maxEnd] = await prisma.$queryRawUnsafe(
    `SELECT MAX("endSec") as m FROM "Segment" WHERE "transcriptId" = $1`, id
  );
  res.json({ minStart: minStart?.m ?? null, maxEnd: maxEnd?.m ?? null });
});

app.put("/api/segments/:id", async (req, res) => {
  const Body = z.object({
    text: z.string().optional(),  // ← Removed min(1) to allow empty strings
    speakerName: z.string().optional(),
    startSec: z.number().optional(),
    endSec: z.number().optional()
  });
  
  const r = Body.safeParse(req.body);
  if (!r.success) {
    return res.status(400).json({ error: r.error.issues?.[0]?.message || "Bad request" });
  }
  const b = r.data;

  // If caller sends text and it's empty/whitespace, treat as delete
  if (typeof b.text === "string" && b.text.trim() === "") {
    await prisma.segment.delete({ where: { id: req.params.id } });
    return res.json({ ok: true, deleted: true });
  }

  const seg = await prisma.segment.update({ where: { id: req.params.id }, data: b });
  res.json(seg);
});


app.post("/api/segments/bulk-assign", async (req, res) => {
  const Body = z.object({ segmentIds: z.array(z.string().min(1)), speakerName: z.string().optional() });
  const b = Body.parse(req.body);
  await prisma.segment.updateMany({
    where: { id: { in: b.segmentIds } },
    data: { speakerName: b.speakerName || null }
  });
  res.json({ ok: true, count: b.segmentIds.length });
});

// --- helpers ---
async function latestTranscript(prisma) {
  return prisma.transcript.findFirst({
    orderBy: { createdAt: "desc" }
  });
}
async function transcriptBySessionTitle(prisma, title) {
  const s = await prisma.session.findFirst({ where: { title } });
  if (!s) return null;
  return prisma.transcript.findFirst({
    where: { sessionId: s.id },
    orderBy: { createdAt: "desc" }
  });
}
function mkTimeRegex() {
  const timeToken = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{3})?|\d+(?:[.,]\d{3})`;
  return {
    line: new RegExp(`^\\s*${timeToken}\\s*-->\\s*${timeToken}(?:\\s+.*)?$`, "i"),
    trailing: new RegExp(`^\\s*${timeToken}\\s*-->\\s*${timeToken}\\s*(.*)$`, "i"),
  };
}
async function cleanupTranscript(prisma, transcriptId) {
  const items = await prisma.segment.findMany({ where: { transcriptId }, orderBy: { createdAt: "asc" } });
  const { line, trailing } = mkTimeRegex();
  let deleted = 0, updated = 0;
  for (const s of items) {
    const t = s.text.trim();
    if (/^WEBVTT$/i.test(t)) { await prisma.segment.delete({ where: { id: s.id } }); deleted++; continue; }
    const cleaned = t
      .split(/\n+/)
      .map(L => {
        const m = L.match(trailing);
        if (m) return (m[1] || "").trim();
        return line.test(L) ? "" : L;
      })
      .filter(Boolean).join(" ").replace(/\s+/g," ").trim();
    if (!cleaned) { await prisma.segment.delete({ where: { id: s.id } }); deleted++; }
    else if (cleaned !== s.text) { await prisma.segment.update({ where: { id: s.id }, data: { text: cleaned } }); updated++; }
  }
  return { updated, deleted };
}

// --- one-click cleanup for the *current/latest* transcript
app.post("/api/transcripts/cleanup/latest", async (_req, res) => {
  const t = await latestTranscript(prisma);
  if (!t) return res.status(404).json({ error: "no transcripts" });
  const r = await cleanupTranscript(prisma, t.id);
  res.json({ ok: true, transcriptId: t.id, ...r });
});

// --- cleanup by *session title* (no IDs)
app.post("/api/transcripts/cleanup/by-title", async (req, res) => {
  const title = (req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  const t = await transcriptBySessionTitle(prisma, title);
  if (!t) return res.status(404).json({ error: "no transcript for that title" });
  const r = await cleanupTranscript(prisma, t.id);
  res.json({ ok: true, transcriptId: t.id, ...r });
});

// --- cleanup by *id* (kept for the UI "Clean current" button)
app.post("/api/transcripts/:id/cleanup", async (req, res) => {
  const r = await cleanupTranscript(prisma, req.params.id);
  res.json({ ok: true, transcriptId: req.params.id, ...r });
});


// Delete one segment
app.delete("/api/segments/:id", async (req, res) => {
  await prisma.segment.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// Bulk delete: { "segmentIds": ["id1","id2",...] }
app.post("/api/segments/bulk-delete", async (req, res) => {
  const segmentIds = req.body?.segmentIds;
  if (!Array.isArray(segmentIds) || !segmentIds.length) {
    return res.status(400).json({ error: "segmentIds[] required" });
  }
  const r = await prisma.segment.deleteMany({ where: { id: { in: segmentIds } } });
  res.json({ ok: true, count: r.count });
});
// List transcripts for a session (newest first)
app.get("/api/sessions/:id/transcripts", async (req, res) => {
  const items = await prisma.transcript.findMany({
    where: { sessionId: req.params.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, fileName: true, createdAt: true }
  });
  res.set("Cache-Control", "no-store");
  res.json(items);
});

// Return the latest transcript for a session (or 404)
app.get("/api/sessions/:id/last", async (req, res) => {
  const t = await prisma.transcript.findFirst({
    where: { sessionId: req.params.id },
    orderBy: { createdAt: "desc" }
  });
  if (!t) return res.status(404).json({ error: "no transcripts for this session" });
  res.json(t);
});

// Optional: one-call "resume latest across all sessions"
app.get("/api/resume", async (_req, res) => {
  const t = await prisma.transcript.findFirst({
    orderBy: { createdAt: "desc" },
    include: { session: true }
  });
  if (!t) return res.status(404).json({ error: "no transcripts yet" });
  res.json(t);
});

// Export: copy-ready text for a speaker
app.get("/api/export/transcript/:id/speaker/:name.txt", async (req, res) => {
  const segs = await prisma.segment.findMany({
    where: { transcriptId: req.params.id, speakerName: req.params.name },
    orderBy: { createdAt: "asc" }
  });
  res.type("text/plain").send(segs.map(s => s.text).join("\n\n"));
});

const PORT = process.env.PORT || 5178;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));

// Build novelization text from a transcript's segments (names always included)
async function buildNovelizeText(prisma, transcriptId, { title = "Transcript", fallbackName = "Narrator" } = {}) {
  const segs = await prisma.segment.findMany({
    where: { transcriptId },
    orderBy: { createdAt: "asc" }
  });

  // merge consecutive segments by the same speaker
  const merged = [];
  for (const s of segs) {
    const name = (s.speakerName || fallbackName).trim();
    const text = (s.text || "").trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.name === name) last.text += " " + text;
    else merged.push({ name, text });
  }

  let out = `# ${title}\n\n`;
  for (const m of merged) {
    out += `${m.name}: ${m.text}\n\n`;
  }
  return out;
}

// GET /api/export/transcript/:id/novelize.txt?title=...&fallback=...
app.get("/api/export/transcript/:id/novelize.txt", async (req, res) => {
  const title = (req.query.title || "Transcript").toString();
  const fallbackName = (req.query.fallback || "Narrator").toString();
  const txt = await buildNovelizeText(prisma, req.params.id, { title, fallbackName });
  res.setHeader("Content-Disposition", `attachment; filename="novelize.txt"`);
  res.type("text/plain").send(txt);
});

// Latest overall (names always included)
app.get("/api/export/latest/novelize.txt", async (req, res) => {
  const t = await prisma.transcript.findFirst({ orderBy: { createdAt: "desc" }, include: { session: true } });
  if (!t) return res.status(404).type("text/plain").send("No transcripts found.");
  const title = (req.query.title || t.session?.title || "Transcript").toString();
  const fallbackName = (req.query.fallback || "Narrator").toString();
  const txt = await buildNovelizeText(prisma, t.id, { title, fallbackName });
  res.setHeader("Content-Disposition", `attachment; filename="novelize.txt"`);
  res.type("text/plain").send(txt);
});

// By session title (latest transcript in that session)
app.get("/api/export/by-title/novelize.txt", async (req, res) => {
  const sessionTitle = (req.query.title || "").toString().trim();
  if (!sessionTitle) return res.status(400).type("text/plain").send("Missing ?title=");
  const s = await prisma.session.findFirst({ where: { title: sessionTitle } });
  if (!s) return res.status(404).type("text/plain").send("No session with that title.");
  const t = await prisma.transcript.findFirst({ where: { sessionId: s.id }, orderBy: { createdAt: "desc" } });
  if (!t) return res.status(404).type("text/plain").send("No transcript in that session.");

  const fileHeader = (req.query.filetitle || s.title).toString();
  const fallbackName = (req.query.fallback || "Narrator").toString();
  const txt = await buildNovelizeText(prisma, t.id, { title: fileHeader, fallbackName });
  res.setHeader("Content-Disposition", `attachment; filename="novelize.txt"`);
  res.type("text/plain").send(txt);
});
// Delete an entire transcript (and its segments)
app.delete("/api/transcripts/:id", async (req, res) => {
  const id = req.params.id;

  // If your Prisma schema already has ON DELETE CASCADE on Segment.transcriptId,
  // this delete() is enough. If not, delete children first:
  await prisma.segment.deleteMany({ where: { transcriptId: id } });

  try {
    await prisma.transcript.delete({ where: { id } });
  } catch (e) {
    // Return a friendlier 404 if the transcript doesn't exist
    return res.status(404).json({ error: "Transcript not found" });
  }

  res.set("Cache-Control", "no-store");
  res.json({ ok: true, id });
});
// Danger: removes ALL sessions, transcripts, and segments.
// Call with: POST /api/admin/wipe  body: {"confirm":"WIPE"}
// Optional header: x-allow-wipe: yes
app.post("/api/admin/wipe", async (req, res) => {
  try {
    const ok =
      (req.headers["x-allow-wipe"] === "yes") ||
      (req.body && req.body.confirm === "WIPE");
    if (!ok) {
      return res.status(400).json({
        error: 'Refused. Send {"confirm":"WIPE"} in JSON body or header x-allow-wipe: yes.'
      });
    }

    // delete in dependency order in case FKs aren’t cascading
    const seg = await prisma.segment.deleteMany({});
    const trn = await prisma.transcript.deleteMany({});
    const ses = await prisma.session.deleteMany({});

    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      deleted: { segments: seg.count, transcripts: trn.count, sessions: ses.count }
    });
  } catch (e) {
    console.error("WIPE_ERROR:", e);
    res.status(500).json({ error: String(e.message || e) });
  }
});
