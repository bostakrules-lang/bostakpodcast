// Run whisper.cpp on each cut clip to produce per-clip caption JSON.
// Uses word-level timestamps so karaoke subs match exactly.
//
// Usage:
//   node scripts/transcribe-clips.mjs <episode-dir>
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
import { ensureDir, PUBLIC_DIR, writeJSON } from "./lib.mjs";

const episodeDir = process.argv[2];
if (!episodeDir) {
  console.error("Usage: node scripts/transcribe-clips.mjs <episode-dir>");
  process.exit(1);
}

const clips = JSON.parse(fs.readFileSync(path.join(episodeDir, "clips.json"), "utf8"));

console.log(`📥 Ensuring whisper.cpp ${WHISPER_VERSION} + model ${WHISPER_MODEL}…`);
await installWhisperCpp({ to: WHISPER_PATH, version: WHISPER_VERSION });
await downloadWhisperModel({ folder: WHISPER_PATH, model: WHISPER_MODEL });

for (const c of clips) {
  const clipAbs = path.join(PUBLIC_DIR, c.clipFile);
  const jsonAbs = clipAbs.replace(/\.mp4$/, ".json");
  if (fs.existsSync(jsonAbs)) {
    console.log(`⏭️  skip ${path.basename(clipAbs)} (already transcribed)`);
    continue;
  }
  const tmpDir = path.join(path.dirname(clipAbs), ".tmp");
  ensureDir(tmpDir);
  const wav = path.join(tmpDir, path.basename(clipAbs).replace(/\.mp4$/, ".wav"));

  console.log(`🎧 wav extract ${path.basename(clipAbs)}`);
  execSync(
    `npx remotion ffmpeg -y -i "${clipAbs}" -ac 1 -ar 16000 "${wav}"`,
    { stdio: ["ignore", "inherit", "inherit"] },
  );

  console.log(`📝 whisper ${path.basename(clipAbs)}`);
  const wOut = await transcribe({
    inputPath: wav,
    model: WHISPER_MODEL,
    tokenLevelTimestamps: true,
    whisperPath: WHISPER_PATH,
    whisperCppVersion: WHISPER_VERSION,
    printOutput: false,
    translateToEnglish: false,
    language: WHISPER_LANG,
    splitOnWord: true,
  });
  const { captions } = toCaptions({ whisperCppOutput: wOut });

  // Post-process: enforce consistent English spelling & common brand fixes.
  const fixed = captions.map((c) => ({ ...c, text: postFix(c.text) }));

  writeJSON(jsonAbs, fixed);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("\n✅ All clips transcribed.");

function postFix(txt) {
  if (!txt) return txt;
  // Very light orthographic hygiene — don't change meaning, just fix tokens we've seen whisper
  // split oddly. Add brand-safe replacements over time.
  return txt
    .replace(/\bbiohackit\b/gi, "Biohack-it")
    .replace(/\bbiohack it\b/gi, "Biohack-it")
    .replace(/ ,/g, ",")
    .replace(/ \./g, ".")
    .replace(/ '/g, "'");
}
