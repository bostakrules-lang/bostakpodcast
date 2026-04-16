// Transcribe each cut clip using faster-whisper (small.en) to produce word-level Caption[] JSON
// that Remotion's <Subtitles> component consumes.
//
// Usage:
//   node scripts/transcribe-clips-fast.mjs <episode-dir>
//
// Reqs: transcribe_fast.py in repo root, faster-whisper installed (pip).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { PUBLIC_DIR, ensureDir } from "./lib.mjs";

const episodeDir = process.argv[2];
if (!episodeDir) {
  console.error("Usage: node scripts/transcribe-clips-fast.mjs <episode-dir>");
  process.exit(1);
}

const PY_SCRIPT = "/sessions/adoring-pensive-albattani/transcribe_fast.py";
const MODEL = process.env.WHISPER_MODEL || "small.en";

const clips = JSON.parse(fs.readFileSync(path.join(episodeDir, "clips.json"), "utf8"));

for (const c of clips) {
  const clipAbs = path.join(PUBLIC_DIR, c.clipFile);
  const jsonAbs = clipAbs.replace(/\.mp4$/, ".json");
  const srtAbs  = clipAbs.replace(/\.mp4$/, ".srt");
  if (fs.existsSync(jsonAbs) && fs.existsSync(srtAbs)) {
    console.log(`⏭️  skip ${path.basename(clipAbs)} (already transcribed)`);
    continue;
  }
  const tmpDir = path.join(path.dirname(clipAbs), ".tmp");
  ensureDir(tmpDir);
  const wav = path.join(tmpDir, path.basename(clipAbs).replace(/\.mp4$/, ".wav"));

  console.log(`🎧 wav ${path.basename(clipAbs)}`);
  execSync(
    `ffmpeg -hide_banner -loglevel error -y -i "${clipAbs}" -ac 1 -ar 16000 "${wav}"`,
    { stdio: "inherit" },
  );

  console.log(`📝 whisper ${path.basename(clipAbs)}`);
  execSync(
    `python3 "${PY_SCRIPT}" "${wav}" "${jsonAbs}" "${srtAbs}" "${MODEL}"`,
    { stdio: "inherit" },
  );

  // Post-fix brand naming
  const captions = JSON.parse(fs.readFileSync(jsonAbs, "utf8"));
  const fixed = captions.map((w) => ({
    ...w,
    text: postFix(w.text),
  }));
  fs.writeFileSync(jsonAbs, JSON.stringify(fixed));
  try { fs.rmSync(wav, { force: true }); } catch {}
}

try { fs.rmSync(path.join(PUBLIC_DIR, path.dirname(clips[0].clipFile), ".tmp"), { recursive: true, force: true }); } catch {}
console.log("\n✅ All clips transcribed.");

function postFix(txt) {
  if (!txt) return txt;
  return txt
    .replace(/\bbiohackit\b/gi, "Biohack-it")
    .replace(/\bbiohack it\b/gi, "Biohack-it")
    .replace(/\bmira marlow(e)?\b/gi, "Maria Marlowe");
}
