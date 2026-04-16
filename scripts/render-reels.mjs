// Render each clip through the Remotion "Reel" composition (hook overlay + subs + logo + music).
//
// Usage:
//   node scripts/render-reels.mjs <episode-dir>
//
// Output: output/<episode-slug>/reel-XX.mp4
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { ensureDir, OUTPUT_DIR, slugify } from "./lib.mjs";

const episodeDir = process.argv[2];
if (!episodeDir) {
  console.error("Usage: node scripts/render-reels.mjs <episode-dir>");
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(path.join(episodeDir, "meta.json"), "utf8"));
const clips = JSON.parse(fs.readFileSync(path.join(episodeDir, "clips.json"), "utf8"));

const slug = slugify(meta.slug);
const outDir = path.join(OUTPUT_DIR, slug);
ensureDir(outDir);

for (const c of clips) {
  const idx = String(c.index).padStart(2, "0");
  const outFile = path.join(outDir, `reel-${idx}.mp4`);
  if (fs.existsSync(outFile)) {
    console.log(`⏭️  skip reel-${idx} (exists)`);
    continue;
  }

  const props = {
    src: c.clipFile, // public/clips/<slug>/clip-XX.mp4
    hook: c.hook,
    music: c.music || undefined,
    musicVolume: c.music ? 0.15 : undefined,
  };

  // Write props to a temp file — most reliable across shells/quoting
  const propsFile = `/sessions/adoring-pensive-albattani/.props-${slug}-${idx}.json`;
  fs.writeFileSync(propsFile, JSON.stringify(props));
  console.log(`🎬 Rendering reel-${idx}  ${c.hook}`);
  execSync(
    `npx remotion render Reel "${outFile}" ` +
      `--props="${propsFile}" ` +
      `--concurrency=4 --log=info`,
    { stdio: "inherit" },
  );
  try { fs.unlinkSync(propsFile); } catch {}
}

console.log(`\n✅ All reels rendered → ${outDir}`);
