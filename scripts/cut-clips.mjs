// Cut 12 clips from the episode source, re-frame to 9:16, optionally mix music.
//
// Usage:
//   node scripts/cut-clips.mjs <episode-dir>
//
// Reads:  <episode-dir>/source.*  +  <episode-dir>/clips.json
// Writes: public/clips/<episode-slug>/clip-XX.mp4  +  public/clips/<episode-slug>/clip-XX.wav
//         — the wavs are then captioned by transcribe-clips.mjs.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { ensureDir, CLIPS_DIR, MUSIC_DIR, slugify } from "./lib.mjs";

const episodeDir = process.argv[2];
if (!episodeDir) {
  console.error("Usage: node scripts/cut-clips.mjs <episode-dir>");
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(path.join(episodeDir, "meta.json"), "utf8"));
const clips = JSON.parse(fs.readFileSync(path.join(episodeDir, "clips.json"), "utf8"));
const source = path.join(episodeDir, meta.file);
const slug = slugify(meta.slug);

const outDir = path.join(CLIPS_DIR, slug);
ensureDir(outDir);

// Detect aspect of source to decide crop filter
const probe = JSON.parse(
  execSync(
    `ffprobe -v quiet -print_format json -show_streams -select_streams v:0 "${source}"`,
  ).toString(),
);
const w = probe.streams[0].width;
const h = probe.streams[0].height;
const isLandscape = w / h > 1.1;
console.log(`🎥 Source is ${w}x${h} — ${isLandscape ? "landscape (will crop to 9:16)" : "already vertical"}`);

// Reframe 16:9 podcast footage → 9:16 WITHOUT cropping the speakers.
// Strategy: blurred background (video zoomed+blurred to cover 1080x1920) + clean
// foreground (original video scaled to 1080 wide, centered vertically).
// Matches the industry standard for podcast reels.
const vfReframe = isLandscape
  ? "[0:v]split=2[bg][fg];" +
    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:1,eq=brightness=-0.1[bgb];" +
    "[fg]scale=1080:-2[fgs];" +
    "[bgb][fgs]overlay=x=(W-w)/2:y=(H-h)/2,setsar=1"
  : "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

const musicFiles = fs.existsSync(MUSIC_DIR)
  ? fs
      .readdirSync(MUSIC_DIR)
      .filter((f) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(f))
  : [];

const pickMusic = (i) => (musicFiles.length ? musicFiles[i % musicFiles.length] : null);

const updated = [];
for (const c of clips) {
  const idx = String(c.index).padStart(2, "0");
  const durSec = (c.endMs - c.startMs) / 1000;
  const startSec = c.startMs / 1000;

  const clipName = `clip-${idx}.mp4`;
  const outPath = path.join(outDir, clipName);

  console.log(`✂️  Clip ${idx}  [${fmt(c.startMs)}-${fmt(c.endMs)}]  ${c.hook}`);

  // 1) cut + reframe (no audio mixing yet — done later, after we know music choice)
  const filterFlag = isLandscape ? `-filter_complex "${vfReframe}"` : `-vf "${vfReframe}"`;
  execSync(
    `ffmpeg -hide_banner -loglevel error -y -ss ${startSec} -i "${source}" -t ${durSec} ` +
      `${filterFlag} -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 192k "${outPath}"`,
    { stdio: "inherit" },
  );

  const music = pickMusic(c.index - 1);
  updated.push({
    ...c,
    clipFile: path.posix.join("clips", slug, clipName), // public/ relative
    music: music ? path.posix.join("music", music) : null,
  });
}

// Save the updated clips manifest for the render step
fs.writeFileSync(
  path.join(episodeDir, "clips.json"),
  JSON.stringify(updated, null, 2),
);

// Also save a pointer at public/clips/<slug>/manifest.json so the Studio/renderer can find them
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(updated, null, 2));

console.log(`\n✅ Cut ${updated.length} clips → ${outDir}`);

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
