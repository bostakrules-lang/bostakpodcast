#!/usr/bin/env node
// One-command orchestrator. Turns a Drive/Dropbox link into 12 Biohack-it reels.
//
// Usage:
//   node scripts/run.mjs <drive-or-dropbox-url> [--slug my-episode] [--skip-download]
//
// Pipeline:
//   1) download.mjs           → episodes/<slug>/source.mp4
//   2) transcribe.mjs         → episodes/<slug>/transcript.{json,srt}
//   3) select-clips.mjs       → episodes/<slug>/clips.json   (via Claude)
//   4) cut-clips.mjs          → public/clips/<slug>/clip-XX.mp4
//   5) transcribe-clips.mjs   → public/clips/<slug>/clip-XX.json (word-level)
//   6) render-reels.mjs       → output/<slug>/reel-XX.mp4
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { EPISODES_DIR, ensureDir, loadDotEnv, slugify } from "./lib.mjs";

loadDotEnv();

const args = process.argv.slice(2);
const skipDownload = args.includes("--skip-download");
const slugIdx = args.indexOf("--slug");
const explicitSlug = slugIdx !== -1 ? args[slugIdx + 1] : null;
const url = args.find((a) => /^https?:/.test(a));

if (!url && !skipDownload && !explicitSlug) {
  console.error(
    "Usage: node scripts/run.mjs <drive-or-dropbox-url> [--slug NAME]\n" +
      "       node scripts/run.mjs --skip-download --slug NAME   # reuse already-downloaded episode",
  );
  process.exit(1);
}

const step = (n, title) => console.log(`\n\x1b[1m━━ Step ${n}/6 — ${title} ━━\x1b[0m`);

const sh = (cmd) => execSync(cmd, { stdio: "inherit" });

let episodeDir;
if (skipDownload) {
  if (!explicitSlug) {
    console.error("❌ --skip-download requires --slug NAME");
    process.exit(1);
  }
  episodeDir = path.join(EPISODES_DIR, slugify(explicitSlug));
  if (!fs.existsSync(episodeDir)) {
    console.error(`❌ Episode dir not found: ${episodeDir}`);
    process.exit(1);
  }
} else {
  step(1, "Downloading source from Drive/Dropbox");
  const args = [`"${url}"`];
  if (explicitSlug) args.push(`--slug`, `"${explicitSlug}"`);
  // download.mjs prints the final episode dir as the last stdout line
  const out = execSync(`node scripts/download.mjs ${args.join(" ")}`, {
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
  episodeDir = out.trim().split("\n").pop().trim();
  console.log(`📦 Episode: ${episodeDir}`);
}

const transcriptJson = path.join(episodeDir, "transcript.json");
if (!fs.existsSync(transcriptJson)) {
  step(2, "Transcribing full episode with Whisper");
  sh(`node scripts/transcribe.mjs "${episodeDir}"`);
} else {
  console.log("\n⏭️  Step 2 skipped — transcript cached");
}

const clipsJson = path.join(episodeDir, "clips.json");
if (!fs.existsSync(clipsJson)) {
  step(3, "Selecting 12 viral clips with Claude");
  sh(`node scripts/select-clips.mjs "${episodeDir}"`);
} else {
  console.log("\n⏭️  Step 3 skipped — clips.json cached");
}

step(4, "Cutting + reframing clips to 9:16");
sh(`node scripts/cut-clips.mjs "${episodeDir}"`);

step(5, "Transcribing each clip (word-level subs)");
sh(`node scripts/transcribe-clips.mjs "${episodeDir}"`);

step(6, "Rendering 12 reels");
sh(`node scripts/render-reels.mjs "${episodeDir}"`);

console.log(`\n\x1b[1;32m🎉 DONE.\x1b[0m  Reels are in: output/${path.basename(episodeDir)}/`);
