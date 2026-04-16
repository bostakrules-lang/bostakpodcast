// Transcribe a full episode with Whisper.cpp (word-level timestamps).
//
// Usage:
//   node scripts/transcribe.mjs <episode-dir>
//
// Output:
//   <episode-dir>/transcript.json     (Remotion Caption[] — word-level)
//   <episode-dir>/transcript.srt      (for Claude selector)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  downloadWhisperModel,
  installWhisperCpp,
  transcribe,
  toCaptions,
} from "@remotion/install-whisper-cpp";
import {
  WHISPER_LANG,
  WHISPER_MODEL,
  WHISPER_PATH,
  WHISPER_VERSION,
} from "../whisper-config.mjs";
import { ensureDir, writeJSON } from "./lib.mjs";

const episodeDir = process.argv[2];
if (!episodeDir) {
  console.error("Usage: node scripts/transcribe.mjs <episode-dir>");
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(path.join(episodeDir, "meta.json"), "utf8"));
const sourceFile = path.join(episodeDir, meta.file);

const tempDir = path.join(episodeDir, ".tmp");
ensureDir(tempDir);
const wavFile = path.join(tempDir, "audio.wav");

console.log("🎧 Extracting 16kHz mono wav for whisper…");
execSync(
  `npx remotion ffmpeg -y -i "${sourceFile}" -ac 1 -ar 16000 "${wavFile}"`,
  { stdio: ["ignore", "inherit", "inherit"] },
);

console.log(`📥 Ensuring whisper.cpp ${WHISPER_VERSION} + model ${WHISPER_MODEL}…`);
await installWhisperCpp({ to: WHISPER_PATH, version: WHISPER_VERSION });
await downloadWhisperModel({ folder: WHISPER_PATH, model: WHISPER_MODEL });

console.log("📝 Transcribing (this may take a while on CPU)…");
const t0 = Date.now();
const whisperOutput = await transcribe({
  inputPath: wavFile,
  model: WHISPER_MODEL,
  tokenLevelTimestamps: true,
  whisperPath: WHISPER_PATH,
  whisperCppVersion: WHISPER_VERSION,
  printOutput: false,
  translateToEnglish: false,
  language: WHISPER_LANG,
  splitOnWord: true,
});
const { captions } = toCaptions({ whisperCppOutput: whisperOutput });
console.log(`✅ Transcribed in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${captions.length} tokens`);

writeJSON(path.join(episodeDir, "transcript.json"), captions);

// Build an SRT grouped into ~max-chars captions for Claude consumption
const srt = buildSrt(captions, { maxChars: 80, maxGapMs: 600 });
fs.writeFileSync(path.join(episodeDir, "transcript.srt"), srt);

// Cleanup wav
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`📄 Transcript saved → ${path.join(episodeDir, "transcript.json")}`);
console.log(`📄 SRT saved → ${path.join(episodeDir, "transcript.srt")}`);

function buildSrt(captions, { maxChars = 80, maxGapMs = 600 }) {
  if (!captions.length) return "";
  const lines = [];
  let cur = { from: captions[0].startMs, to: captions[0].endMs, text: captions[0].text.trim() };
  for (let i = 1; i < captions.length; i++) {
    const c = captions[i];
    const gap = c.startMs - cur.to;
    const candidate = (cur.text + " " + c.text).trim().replace(/\s+/g, " ");
    if (gap > maxGapMs || candidate.length > maxChars) {
      lines.push(cur);
      cur = { from: c.startMs, to: c.endMs, text: c.text.trim() };
    } else {
      cur.to = c.endMs;
      cur.text = candidate;
    }
  }
  lines.push(cur);

  return lines
    .map((l, i) => `${i + 1}\n${msToSrtTs(l.from)} --> ${msToSrtTs(l.to)}\n${l.text}\n`)
    .join("\n");
}

function msToSrtTs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mss = Math.floor(ms % 1000);
  const pad = (n, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(mss, 3)}`;
}
