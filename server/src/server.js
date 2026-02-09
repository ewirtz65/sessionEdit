import "dotenv/config";
import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..", "..");
import multer from "multer";
const upload = multer({ storage: multer.memoryStorage() });
import fs from "fs/promises";



// tiny helpers
function splitTxt(text) {
  return text.replace(/\r/g, "")
    .split(/\n\s*\n/)                // blank line = new segment
    .map(t => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
// Spelling normalization for in-text mentions and speaker names
//search words must be all lower case
const NAME_MAP = {
  //Dain variants
  "dane": "Dain",
  "dana": "Dain",
  "dan": "Dain",
  "dang": "Dain",
  "dave": "Dain",
  "dayne": "Dain",
  "dade": "Dain",
  "zane": "Dain",
  "jane": "Dain", 
  "dean": "Dain",
  //Johnny variants
  "jonny": "Johnny",
  "johanna": "Johann",
  "johan": "Johann",
  //Crudark variants
  "crudark": "Crudark",
  "crudart": "Crudark",
  "crudar": "Crudark",
  "krudark": "Crudark",
  "krudak": "Crudark",
  "crudarck": "Crudark",
  "kudark": "Crudark",
  "kudar": "Crudark",
  "krudar": "Crudark",
  "kudak": "Crudark",
  "krudal": "Crudark",
  "kruidark": "Crudark",
  "krewdark": "Crudark",
  "kruger": "Crudark",
  "kruidork": "Crudark",
  "rudark": "Crudark",
  "prudark": "Crudark",
  "grudark": "Crudark",
  "prudarch": "Crudark",
  "kruark ": "Crudark",
  "crudak": "Crudark",
  "drew dark": "Crudark",
  "crew dark": "Crudark",
  "crude archon": "Crudark",
  "krewduck": "Crudark",
  "krudarch": "Crudark",
  //Inda variants
  "enda": "Inda",
  "endo": "Inda",
  //Truvik variants
  "trubik": "Truvik",
  "trubick": "Truvik",
  "truvic": "Truvik",
  "trevor ": "Truvik",
  "truvick": "Truvik",
  "trufic": "Truvik",
  "true bit": "Truvik",
  "struvik": "Truvik",
  "brubit": "Truvik",
  "ruvik": "Truvik",
  "prubik": "Truvik",
  //Lift variants
  "lyft": "Lift",
  "liff": "Lift",
  "liv": "Lift",
  "lyfz": "Lift",

  //Shadar-Kai variants
  "shudderky": "Shadar-Kai",
  "shadarkai": "Shadar-Kai",
  "shadrakai": "Shadar-Kai",
  "chetarchai": "Shadar-Kai",
  "shad archive": "Shadar-Kai",
  "shadow archive": "Shadar-Kai",
  "shatterkite": "Shadar-Kai",
  "shatterkit": "Shadar-Kai",
  "shatter kai": "Shadar-Kai",
  "shed archive": "Shadar-Kai",
  "shot archives": "Shadar-Kai",
  "shatter cry": "Shadar-Kai",
  "shadow cards": "Shadar-Kai",
  "shadarchai": "Shadar-Kai",
  "shadarch": "Shadar-Kai",
   //other corrections
  "illimath": "Ilmater",
  "elmater": "Ilmater",
  "shadowfel": "Shadowfell",
  "elephant": "Illithid", 
  "vekna": "Vecna",
  "vecina": "Vecna",
  "vecno": "Vecna",
  "opelix": "obelisk",
  "barobi": "Barovia",
  "sarad": "Strahd",
  "straub": "Strahd",
  "strawed": "Strahd",
  "straube": "Strahd",


};

// Fix whole-word matches, case-insensitive (e.g., "jonny" -> "Johnny")
function applyNameFixes(text) {
  if (!text) return text;
  let out = text;
  for (const [bad, good] of Object.entries(NAME_MAP)) {
    // \b boundaries; keep it simple and safe (no partial-in-word hits)
    const re = new RegExp(`\\b${bad}\\b`, "gi");
    out = out.replace(re, good);
  }
  return out;
}

// Normalize a speaker label if it matches a bad spelling
function normalizeSpeakerName(name) {
  if (!name) return name;
  const good = NAME_MAP[name.toLowerCase()];
  return good || name;
}

function toSec(tok) {
  // supports H:MM:SS.mmm, MM:SS.mmm, SS.mmm, with . or ,
  const s = String(tok).trim().replace(",", ".");
  const parts = s.split(":").map(Number);
  if (parts.length === 1) return parseFloat(parts[0] || 0);
  if (parts.length === 2) return parts[0] * 60 + parseFloat(parts[1] || 0);
  // H:MM:SS(.ms)
  return (parts[0] * 3600) + (parts[1] * 60) + parseFloat(parts[2] || 0);
}
function parseTimed(text) {
  const src = text.replace(/\r/g, "");
  const blocks = src.split(/\n\s*\n/);
  const segs = [];
  const timeToken = '(?:\\d{1,2}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{3})?|\\d+(?:[.,]\\d{3})';
  const timeRange = new RegExp(`^\\s*(${timeToken})\\s*-->\\s*(${timeToken})(?:\\s+.*)?$`, "i");

  for (const b of blocks) {
    const lines = b.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.length === 1 && /^WEBVTT$/i.test(lines[0])) continue;

    let i = 0;
    if (/^\d+$/.test(lines[0])) i = 1; // cue index

    let start = null, end = null, carry = "";
    const m = timeRange.exec(lines[i] || "");
    if (m) { start = toSec(m[1]); end = toSec(m[2]); carry = m[3] ? m[3].trim() : ""; i += 1; }

    const content = [carry, ...lines.slice(i)]
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (content) segs.push({ text: content, startSec: start ?? null, endSec: end ?? null });
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

// Import transcript text (VTT/SRT/TXT or pasted) and optionally attach audio
const importUpload = upload.fields([{ name: "file", maxCount: 1 }, { name: "audio", maxCount: 1 }]);
app.post("/api/import", importUpload, async (req, res) => {
  let createdTranscriptId = null; // so we can clean up on failure
  try {
    const title = (req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "title is required" });

    // create/find session
    const session = await getOrCreateSession({
      title,
      date: req.body?.date,
      notes: req.body?.notes,
      prisma
    });

    // get transcript text (file or pasted)
    let text = "";
    let fileName = req.body?.fileName || "uploaded.txt";
    if (req.files?.file?.[0]) {
      fileName = req.files.file[0].originalname || fileName;
      text = req.files.file[0].buffer.toString("utf8");
    } else {
      text = req.body?.text || "";
    }
    if (!text.trim()) return res.status(400).json({ error: "empty transcript" });

    // detect timing
    const looksTimed =
      /^WEBVTT/m.test(text) ||
      /\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d{3}/.test(text) ||
      /\b\d+(?:[.,]\d{3})\s*-->\s*\d+(?:[.,]\d{3})/.test(text);

    // parse to uniform objects
    const parsed = looksTimed
      ? parseTimed(text)                         // [{ text,startSec?,endSec? }]
      : splitTxt(text).map(t => ({ text: t }));  // plain → objects

    // create the transcript first
    let transcript = await prisma.transcript.create({
      data: { sessionId: session.id, fileName },
      select: { id: true, sessionId: true, fileName: true, audioUrl: true }
    });
    createdTranscriptId = transcript.id;

    // optional audio save
    if (req.files?.audio?.[0]) {
      const audio = req.files.audio[0];
      const dir = path.join(ROOT_DIR, "uploads", "audio");
      await fs.mkdir(dir, { recursive: true });
      const outPath = path.join(dir, `${Date.now()}-${audio.originalname}`);
      await fs.writeFile(outPath, audio.buffer);
      const rel = `/uploads/audio/${path.basename(outPath)}`;
      transcript = await prisma.transcript.update({
        where: { id: transcript.id },
        data: { audioUrl: rel },
        select: { id: true, sessionId: true, fileName: true, audioUrl: true }
      });
    }

    // bulk insert segments using createMany (no interactive tx)
    if (parsed.length) {
      const rows = parsed.map(s => ({
        transcriptId: transcript.id,
        text: s.text,
        startSec: s.startSec ?? undefined,
        endSec: s.endSec ?? undefined
      }));
      const CHUNK = 2000;                       // safe for large files
      for (let i = 0; i < rows.length; i += CHUNK) {
        await prisma.segment.createMany({ data: rows.slice(i, i + CHUNK) });
      }
    }

    res.json({ session, transcript, segmentsCreated: parsed.length });
  } catch (err) {
    console.error("IMPORT_ERROR:", err);
    // if we created a transcript but failed mid-way, delete it to avoid zombies
    if (createdTranscriptId) {
      try {
        await prisma.segment.deleteMany({ where: { transcriptId: createdTranscriptId } });
        await prisma.transcript.delete({ where: { id: createdTranscriptId } });
      } catch { }
    }
    res.status(500).json({ error: String(err.message || err) });
  }
});


app.use(cors());
// Allow Chrome Private Network Access (needed when accessing via hostname like "mimir")
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/api/health", (req, res) => res.json({ ok: true }));
// serve uploaded audio
app.use("/uploads", (await import("express")).default.static(path.join(ROOT_DIR, "uploads")));


// GET /api/transcripts/:id/segments?limit=200&offset=0&speaker=&q=
app.get("/api/transcripts/:id/segments", async (req, res) => {
  const id = req.params.id;
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const offset = parseInt(req.query.offset) || 0;
  const speaker = (req.query.speaker || "").trim();
  const q = (req.query.q || "").trim();

  const where = { transcriptId: id };
  if (speaker) where.speakerName = speaker;
  if (q) where.text = { contains: q };

  const [items, total] = await Promise.all([
    prisma.segment.findMany({
      where,
      orderBy: [{ startSec: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit,
      select: { id: true, text: true, speakerName: true, startSec: true, endSec: true }
    }),
    prisma.segment.count({ where })
  ]);

  // ADD ABSOLUTE POSITIONS
  if (q || speaker) {
    // During search: get all IDs to find positions
    const allSegments = await prisma.segment.findMany({
      where: { transcriptId: id },
      orderBy: [{ startSec: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true }
    });

    const positionMap = new Map();
    allSegments.forEach((seg, index) => {
      positionMap.set(seg.id, index + 1);
    });

    items.forEach(item => {
      item.absolutePosition = positionMap.get(item.id);
    });
  } else {
    // No search: simple offset calculation
    items.forEach((item, index) => {
      item.absolutePosition = offset + index + 1;
    });
  }

  res.set("Cache-Control", "no-store");
  res.json({ total, items, limit, offset });
});

// Sessions
// GET /api/sessions
app.get("/api/sessions", async (_req, res) => {
  const sessions = await prisma.session.findMany({
    where: { transcripts: { some: {} } },        // ← only sessions that still have transcripts
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true }
  });
  res.set("Cache-Control", "no-store");
  res.json(sessions);
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

// Speakers used in a given transcript (distinct speakerName values on segments)
app.get("/api/transcripts/:id/speaker-names", async (req, res) => {
  const id = req.params.id;
  const rows = await prisma.segment.findMany({
    where: { transcriptId: id, speakerName: { not: null } },
    select: { speakerName: true }
  });
  const names = Array.from(
    new Set(
      rows
        .map(r => (r.speakerName || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  res.json(names);
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

// Apply affine time fix: new = a*old + b (clamped to >= 0), chunked to avoid engine issues
app.post("/api/transcripts/:id/apply-affine", async (req, res) => {
  try {
    const id = req.params.id;
    const a = Number(req.body?.a);
    const b = Number(req.body?.b);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) {
      return res.status(400).json({ error: "a (>0) and b must be numbers" });
    }

    const segs = await prisma.segment.findMany({
      where: { transcriptId: id },
      select: { id: true, startSec: true, endSec: true }
    });
    if (!segs.length) {
      res.set("Cache-Control", "no-store");
      return res.json({ ok: true, updated: 0, a, b });
    }

    let updated = 0;
    const CHUNK = 500; // safe batch size

    for (let i = 0; i < segs.length; i += CHUNK) {
      const slice = segs.slice(i, i + CHUNK);

      // Build per-row updates (different values => cannot use updateMany)
      const ops = [];
      for (const s of slice) {
        const ns = s.startSec == null ? null : Math.max(0, a * s.startSec + b);
        const ne = s.endSec == null ? null : Math.max(0, a * s.endSec + b);
        if (ns === s.startSec && ne === s.endSec) continue;
        updated++;
        ops.push(
          prisma.segment.update({
            where: { id: s.id },
            data: { startSec: ns, endSec: ne }
          })
        );
      }

      if (ops.length) {
        // Array form -> a single non-interactive transaction; no callback = no P2028
        await prisma.$transaction(ops);
      }
    }

    res.set("Cache-Control", "no-store");
    res.json({ ok: true, updated, a, b });
  } catch (err) {
    console.error("APPLY_AFFINE_ERROR:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});


// meta (optional): min/max time for this transcript
app.get("/api/transcripts/:id/meta", async (req, res) => {
  const id = req.params.id;
  const [minStart] = await prisma.$queryRawUnsafe(
    `SELECT MIN(\`startSec\`) as m FROM \`Segment\` WHERE \`transcriptId\` = ?`, id
  );
  const [maxEnd] = await prisma.$queryRawUnsafe(
    `SELECT MAX(\`endSec\`) as m FROM \`Segment\` WHERE \`transcriptId\` = ?`, id
  );
  res.json({ minStart: minStart?.m ?? null, maxEnd: maxEnd?.m ?? null });
});

app.put("/api/segments/:id", async (req, res) => {
  const Body = z.object({
    text: z.string().optional(),  // ← Removed min(1) to allow empty strings
    speakerName: z.string().nullable().optional(),
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
  const Body = z.object({ segmentIds: z.array(z.string().min(1)), speakerName: z.string().nullable().optional() });
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
// Remove common filler words from transcript text
function stripFillers(text) {
  if (!text) return text;
  return text
    // multi-word first so "kind of" doesn't leave a stray "of"
    .replace(/\bkind of\b/gi, " ")
    .replace(/\buh\b/gi, " ")
    .replace(/\bum\b/gi, " ")
    .replace(/\bjust\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function cleanupTranscript(prisma, transcriptId) {
  const items = await prisma.segment.findMany({ where: { transcriptId }, orderBy: { createdAt: "asc" } });
  const { line, trailing } = mkTimeRegex();
  let deleted = 0, updated = 0;
  function toSec(tok) {
    const s = String(tok).trim().replace(",", ".");
    const parts = s.split(":").map(Number);
    if (parts.length === 1) return parseFloat(parts[0] || 0);
    if (parts.length === 2) return parts[0] * 60 + parseFloat(parts[1] || 0);
    return (parts[0] * 3600) + (parts[1] * 60) + parseFloat(parts[2] || 0);
  }
  const full = new RegExp(String.raw`^\s*(${String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{3})?|\d+(?:[.,]\d{3})`})\s*-->\s*(${String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{3})?|\d+(?:[.,]\d{3})`})(?:\s+.*)?$`, "i");


  for (const s of items) {
    const t = s.text.trim();
    if (/^WEBVTT$/i.test(t)) { await prisma.segment.delete({ where: { id: s.id } }); deleted++; continue; }

    // 1) Strip timing lines / collapse whitespace (existing behavior)
    let foundStart = null, foundEnd = null;
        const rawCleaned = t
      .split(/\n+/)
      .map(L => {
        const fm = L.match(full);
        if (fm) { foundStart = toSec(fm[1]); foundEnd = toSec(fm[2]); return ""; }
        const m = L.match(trailing);
        if (m) return (m[1] || "").trim();
        return line.test(L) ? "" : L;
      })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    // Strip filler words like "um", "just", "kind of"
    const cleaned = stripFillers(rawCleaned);

    if (!cleaned) {
      await prisma.segment.delete({ where: { id: s.id } }); deleted++;
      continue;
    }

    // 2) Apply name fixes to text + normalize speaker
    const fixedText = applyNameFixes(cleaned);
    const fixedSpeaker = normalizeSpeakerName(s.speakerName || null);

    // 3) Update only if something changed
    const needsTextUpdate = fixedText !== s.text;
    const needsSpeakerUpdate = fixedSpeaker !== (s.speakerName || null);

    if (needsTextUpdate || needsSpeakerUpdate || foundStart !== null || foundEnd !== null) {
      await prisma.segment.update({
        where: { id: s.id },
        data: {
          text: fixedText,
          speakerName: fixedSpeaker,
          startSec: (foundStart !== null ? foundStart : undefined),
          endSec: (foundEnd !== null ? foundEnd : undefined),
        }
      });
      updated++;
    }
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
  try {
    const segmentId = req.params.id;

    // Log the deletion attempt
    console.log(`[DELETE] Attempting to delete segment: ${segmentId}`);

    // Try to delete
    const result = await prisma.segment.delete({
      where: { id: segmentId }
    });

    console.log(`[DELETE] Successfully deleted segment ${segmentId}:`, result);
    res.json({ ok: true, deleted: result });
  } catch (error) {
    console.error(`[DELETE] Failed to delete segment ${req.params.id}:`, error);

    // Check if segment doesn't exist
    if (error.code === 'P2025') {
      console.warn(`[DELETE] Segment ${req.params.id} not found (already deleted?)`);
      return res.status(404).json({
        error: "Segment not found",
        id: req.params.id
      });
    }

    // Other errors
    res.status(500).json({
      error: "Delete failed",
      message: error.message,
      id: req.params.id
    });
  }
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

// Helper: Sanitize filename for safe download
function sanitizeFilename(title) {
  return title
    .replace(/[^a-zA-Z0-9\s\-_]/g, '') // Remove special chars
    .replace(/\s+/g, '-')               // Replace spaces with hyphens
    .replace(/-+/g, '-')                // Collapse multiple hyphens
    .replace(/^-|-$/g, '')              // Remove leading/trailing hyphens
    .slice(0, 100)                      // Limit length
    || 'transcript';                    // Fallback if empty
}

// Build novelization text from a transcript's segments
async function buildNovelizeText(prisma, transcriptId, { title = "Transcript", includeSpeakerless = true } = {}) {
  const segs = await prisma.segment.findMany({
    where: { transcriptId },
    orderBy: [{ startSec: "asc" }, { createdAt: "asc" }, { id: "asc" }]
  });

  // merge consecutive segments by the same speaker
  const merged = [];
  for (const s of segs) {
    const text = (s.text || "").trim();
    if (!text) continue;

    const name = s.speakerName ? s.speakerName.trim() : null;

    // Skip segments without speaker if requested
    if (!name && !includeSpeakerless) continue;

    const last = merged[merged.length - 1];
    // Only merge if BOTH segments have speakers AND they match
    // Never merge segments without speakers (null === null should NOT merge)
    if (last && last.name && name && last.name === name) {
      last.text += " " + text;
    } else {
      merged.push({ name, text });
    }
  }

  let out = `# ${title}\n\n`;
  for (const m of merged) {
    if (m.name) {
      out += `${m.name}: ${m.text}\n\n`;
    } else {
      // No speaker - just output the text (for your unedited segments)
      out += `${m.text}\n\n`;
    }
  }
  return out;
}

// GET /api/export/transcript/:id/novelize.txt?title=...&includeSpeakerless=true
app.get("/api/export/transcript/:id/novelize.txt", async (req, res) => {
  const title = (req.query.title || "Transcript").toString();
  const includeSpeakerless = req.query.includeSpeakerless !== "false"; // default true
  const txt = await buildNovelizeText(prisma, req.params.id, { title, includeSpeakerless });
  const filename = sanitizeFilename(title) + '.txt';
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.type("text/plain").send(txt);
});

// Latest overall (includes all segments)
app.get("/api/export/latest/novelize.txt", async (req, res) => {
  const t = await prisma.transcript.findFirst({ orderBy: { createdAt: "desc" }, include: { session: true } });
  if (!t) return res.status(404).type("text/plain").send("No transcripts found.");
  const title = (req.query.title || t.session?.title || "Transcript").toString();
  const includeSpeakerless = req.query.includeSpeakerless !== "false";
  const txt = await buildNovelizeText(prisma, t.id, { title, includeSpeakerless });
  const filename = sanitizeFilename(title) + '.txt';
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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
  const includeSpeakerless = req.query.includeSpeakerless !== "false";
  const txt = await buildNovelizeText(prisma, t.id, { title: fileHeader, includeSpeakerless });
  const filename = sanitizeFilename(fileHeader) + '.txt';
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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

// Delete an entire session (all its transcripts and segments)
app.delete("/api/sessions/:id", async (req, res) => {
  const id = req.params.id;

  // delete children first (safe if FKs don't cascade)
  const transcripts = await prisma.transcript.findMany({
    where: { sessionId: id },
    select: { id: true }
  });

  if (transcripts.length) {
    const tIds = transcripts.map(t => t.id);
    await prisma.segment.deleteMany({ where: { transcriptId: { in: tIds } } });
    await prisma.transcript.deleteMany({ where: { id: { in: tIds } } });
  }

  try {
    await prisma.session.delete({ where: { id } });
  } catch {
    return res.status(404).json({ error: "Session not found" });
  }

  res.set("Cache-Control", "no-store");
  res.json({ ok: true, id, transcriptsDeleted: transcripts.length });
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
// Create a new segment at the end of a transcript
app.post("/api/segments", async (req, res) => {
  const Body = z.object({
    transcriptId: z.string().min(1),
    text: z.string().min(1),
    speakerName: z.string().nullable().optional(),
    startSec: z.number().optional(),
    endSec: z.number().optional(),
  });
  const b = Body.parse(req.body);
  const seg = await prisma.segment.create({
    data: {
      transcriptId: b.transcriptId,
      text: b.text,
      speakerName: b.speakerName || null,
      startSec: b.startSec,
      endSec: b.endSec,
    }
  });
  res.json(seg);
});

// Insert before/after an existing segment by nudging createdAt
app.post("/api/segments/:anchorId/insert", async (req, res) => {
  const Body = z.object({
    where: z.enum(["before", "after"]),
    text: z.string().min(1),
    speakerName: z.string().nullable().optional(),
    startSec: z.number().optional(),
    endSec: z.number().optional(),
  });
  const b = Body.parse(req.body);
  const anchor = await prisma.segment.findUnique({ where: { id: req.params.anchorId } });
  if (!anchor) return res.status(404).json({ error: "anchor not found" });

  // Strategy: set createdAt equal to anchor for "after" (id tie-breaker puts new after),
  // or 1 ms earlier for "before". Your list uses createdAt asc, then id asc. :contentReference[oaicite:2]{index=2}
  const t = anchor.createdAt ? new Date(anchor.createdAt) : new Date();
  const createdAt = (b.where === "before") ? new Date(t.getTime() - 1) : new Date(t.getTime());

  const seg = await prisma.segment.create({
    data: {
      transcriptId: anchor.transcriptId,
      text: b.text,
      speakerName: b.speakerName || null,
      startSec: b.startSec,
      endSec: b.endSec,
      createdAt,
    }
  });
  res.json(seg);
});
// GET /api/transcripts/:id
app.get("/api/transcripts/:id", async (req, res) => {
  const t = await prisma.transcript.findUnique({
    where: { id: req.params.id },
    select: { id: true, fileName: true, createdAt: true, audioUrl: true, sessionId: true }
  });
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(t);
});
// POST /api/transcripts/:id/audio  (multipart form: field name "audio")
const audioUpload = upload.single("audio");
app.post("/api/transcripts/:id/audio", audioUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file required" });

  // Save file to /uploads/audio/<timestamp>-<originalname>
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = path.join(ROOT_DIR, "uploads", "audio");
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, `${Date.now()}-${req.file.originalname}`);
  await fs.writeFile(outPath, req.file.buffer);

  // Make a browser URL
  const rel = `/uploads/audio/${path.basename(outPath)}`;

  const t = await prisma.transcript.update({
    where: { id: req.params.id },
    data: { audioUrl: rel },
    select: { id: true, audioUrl: true }
  });

  res.json(t);
});