// Download a podcast episode from Google Drive / Dropbox / direct URL.
// Picks the "No Ads" variant when given a Drive folder containing multiple files.
//
// Usage:
//   node scripts/download.mjs <drive-or-dropbox-url> [--slug my-episode]
//
// Output: episodes/<slug>/source.mp4  +  episodes/<slug>/meta.json
import fs from "node:fs";
import path from "node:path";
import { ensureDir, EPISODES_DIR, run, runQuiet, slugify, writeJSON } from "./lib.mjs";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/download.mjs <drive-or-dropbox-url> [--slug name]");
  process.exit(1);
}

const slugArgIdx = process.argv.indexOf("--slug");
const explicitSlug = slugArgIdx !== -1 ? process.argv[slugArgIdx + 1] : null;

const isDrive = /drive\.google\.com/.test(url);
const isDropbox = /dropbox\.com/.test(url);

ensureDir(EPISODES_DIR);

const pickSlug = (name) => slugify(explicitSlug || name || `episode-${Date.now()}`);

const normalizeDropbox = (u) => u.replace("?dl=0", "?dl=1").replace("&dl=0", "&dl=1");

const downloadDrive = async () => {
  const isFolder = /\/folders\//.test(url);
  const tmpDir = path.join(EPISODES_DIR, `_tmp_${Date.now()}`);
  ensureDir(tmpDir);

  if (isFolder) {
    console.log("📁 Drive folder detected. Downloading…");
    try {
      run(`gdown --folder "${url}" -O "${tmpDir}"`);
    } catch (e) {
      console.error(
        "\n⚠️  Drive folder download failed. This usually means the folder hit Google's rate-limit.\n" +
          "    Fix: open the folder in your browser, File > Make a copy, and share THAT copy.\n",
      );
      process.exit(1);
    }

    // Pick the "No Ads" file
    const files = walk(tmpDir).filter((f) => /\.(mp4|mov|mkv|webm)$/i.test(f));
    const noAds = files.find((f) => /no\s*ads/i.test(path.basename(f))) || files[0];
    if (!noAds) {
      console.error("❌ No video file found in the Drive folder.");
      process.exit(1);
    }
    console.log(`✅ Selected: ${path.basename(noAds)}`);

    const slug = pickSlug(path.basename(noAds, path.extname(noAds)));
    const outDir = path.join(EPISODES_DIR, slug);
    ensureDir(outDir);
    const outFile = path.join(outDir, "source" + path.extname(noAds));
    fs.renameSync(noAds, outFile);

    // Try to keep the intro too (useful metadata)
    const intro = files.find((f) => /intro/i.test(path.basename(f)));
    if (intro && fs.existsSync(intro)) {
      fs.renameSync(intro, path.join(outDir, "intro" + path.extname(intro)));
    }
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    writeJSON(path.join(outDir, "meta.json"), {
      slug,
      source: url,
      file: path.basename(outFile),
      downloadedAt: new Date().toISOString(),
    });
    console.log(`📦 Episode stored at ${outDir}`);
    return outDir;
  } else {
    // Single file link
    const slug = pickSlug("episode");
    const outDir = path.join(EPISODES_DIR, slug);
    ensureDir(outDir);
    const outFile = path.join(outDir, "source.mp4");
    run(`gdown "${url}" -O "${outFile}"`);
    writeJSON(path.join(outDir, "meta.json"), {
      slug,
      source: url,
      file: "source.mp4",
      downloadedAt: new Date().toISOString(),
    });
    return outDir;
  }
};

const downloadDropbox = async () => {
  const slug = pickSlug("episode");
  const outDir = path.join(EPISODES_DIR, slug);
  ensureDir(outDir);
  const outFile = path.join(outDir, "source.mp4");
  const dlUrl = normalizeDropbox(url);
  run(`curl -L "${dlUrl}" -o "${outFile}"`);
  writeJSON(path.join(outDir, "meta.json"), {
    slug,
    source: url,
    file: "source.mp4",
    downloadedAt: new Date().toISOString(),
  });
  return outDir;
};

const downloadDirect = async () => {
  const slug = pickSlug("episode");
  const outDir = path.join(EPISODES_DIR, slug);
  ensureDir(outDir);
  const ext = path.extname(new URL(url).pathname) || ".mp4";
  const outFile = path.join(outDir, `source${ext}`);
  run(`curl -L "${url}" -o "${outFile}"`);
  writeJSON(path.join(outDir, "meta.json"), {
    slug,
    source: url,
    file: `source${ext}`,
    downloadedAt: new Date().toISOString(),
  });
  return outDir;
};

const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
};

let episodeDir;
if (isDrive) episodeDir = await downloadDrive();
else if (isDropbox) episodeDir = await downloadDropbox();
else episodeDir = await downloadDirect();

console.log(`\n✅ Download complete → ${episodeDir}`);
process.stdout.write(episodeDir);
