// Shared helpers for pipeline scripts
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const PUBLIC_DIR = path.join(ROOT, "public");
export const CLIPS_DIR = path.join(PUBLIC_DIR, "clips");
export const EPISODES_DIR = path.join(ROOT, "episodes");
export const OUTPUT_DIR = path.join(ROOT, "output");
export const MUSIC_DIR = path.join(PUBLIC_DIR, "music");
export const CACHE_DIR = path.join(ROOT, ".cache");

export const ensureDir = (p) => {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
};

export const run = (cmd, opts = {}) => {
  return execSync(cmd, { stdio: "inherit", ...opts });
};

export const runQuiet = (cmd) => {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString();
};

export const msToFrames = (ms, fps = 30) => Math.round((ms / 1000) * fps);
export const hhmmss = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec}`;
};

export const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeJSON = (p, data) =>
  fs.writeFileSync(p, JSON.stringify(data, null, 2));

export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 60);

export const requireEnv = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`\n❌ Missing env var ${name}. Add it to .env and retry.\n`);
    process.exit(1);
  }
  return v;
};

export const loadDotEnv = () => {
  const dotenvPath = path.join(ROOT, ".env");
  if (!fs.existsSync(dotenvPath)) return;
  const lines = fs.readFileSync(dotenvPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
};
