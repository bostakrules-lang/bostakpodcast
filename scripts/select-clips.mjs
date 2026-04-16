// Select exactly 12 reel-worthy moments from an episode transcript using Claude.
// Uses the Biohack-it / DOAC-style editorial prompt validated by the client.
//
// Usage:
//   node scripts/select-clips.mjs <episode-dir>
//
// Output: <episode-dir>/clips.json — array of 12 items:
//   { index, title, hook, startMs, endMs, format, retentionScore, rank, reason }
//
// Requires env: ANTHROPIC_API_KEY
import fs from "node:fs";
import path from "node:path";
import { loadDotEnv, requireEnv, writeJSON } from "./lib.mjs";

loadDotEnv();
const API_KEY = requireEnv("ANTHROPIC_API_KEY");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

const episodeDir = process.argv[2];
if (!episodeDir) {
  console.error("Usage: node scripts/select-clips.mjs <episode-dir>");
  process.exit(1);
}

const srtPath = path.join(episodeDir, "transcript.srt");
if (!fs.existsSync(srtPath)) {
  console.error(`❌ Missing ${srtPath}. Run transcribe.mjs first.`);
  process.exit(1);
}
const srt = fs.readFileSync(srtPath, "utf8");

const SYSTEM_PROMPT = `You are a world-class short-form content strategist specialized in viral clips in the style of Diary of a CEO (DOAC).

Your task is to analyze the provided SRT subtitle file and extract exactly 12 high-performing short-form reels.

Each reel must feel:
- Emotionally engaging
- Insight-driven
- Highly shareable
- Built around a strong hook + payoff

RULES:
- You MUST output exactly 12 reels.
- If there are not enough obvious moments, extract smaller segments or reframe content creatively.
- Prioritize quality, but still reach 12 outputs.
- Each reel should be between 25 and 75 seconds long.
- Clips must NOT overlap. Space them across the full episode.
- The hook overlay text must be UPPERCASE, max 40 characters, punchy and curiosity-driving (e.g. "THE WINDOW OF OPPORTUNITY", "STOP EATING THIS NOW", "WHY DIETS ALWAYS FAIL").
- Avoid repeating the same hook style across all 12 clips — mix myth busts, bold statements, questions, personal admissions.

FOR EACH REEL, RETURN:
- index (1..12)
- title: short editorial title (for internal reference)
- hook: the UPPERCASE red-gradient overlay text shown on the reel (≤40 chars, viral-ready)
- startMs / endMs: integer milliseconds mapped from the SRT timestamps
- format: one of [
    "BOLD OPENING → EXPERT BREAKDOWN → PAYOFF",
    "MYTH BUST → DATA FLIP → PERSONAL STAKE",
    "AUDIENCE ID → VALIDATION → CTA",
    "DIRECT QUESTION → CLEAR ANSWER → UNEXPECTED INSIGHT → PAYOFF",
    "RAPID FIRE MYTH BUST"
  ]
- flow: object with { hook, build, midShift (optional), payoff } — each a short sentence summarizing that beat
- retentionScore: integer 1-10 (probability of full watch-through)
- rank: integer 1-12 (1 = highest viral potential)
- reason: one-line explanation of viral potential

SELECTION CRITERIA:
- Prioritize: contrarian statements, personal admissions, clear myths being challenged, strong analogies, authority/expert insights.
- Avoid: flat or purely informational segments, ad reads, intros, small talk.

OUTPUT FORMAT — STRICT:
Return a single JSON object, and NOTHING ELSE (no prose, no markdown fences). Schema:
{
  "reels": [
    {
      "index": 1,
      "title": "...",
      "hook": "...",
      "startMs": 123456,
      "endMs": 178900,
      "format": "...",
      "flow": { "hook": "...", "build": "...", "midShift": null, "payoff": "..." },
      "retentionScore": 9,
      "rank": 1,
      "reason": "..."
    }
  ]
}
`;

const USER_CONTENT = `Here is the full SRT of the episode. Return the JSON with exactly 12 reels.\n\n<srt>\n${srt}\n</srt>`;

console.log(`🧠 Calling ${MODEL} to select 12 viral clips from transcript (${Math.round(srt.length / 1000)}k chars)…`);
const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: USER_CONTENT }],
  }),
});

if (!res.ok) {
  const txt = await res.text();
  console.error(`❌ Anthropic API error ${res.status}:\n${txt}`);
  process.exit(1);
}

const data = await res.json();
const text = (data.content || []).map((b) => b.text || "").join("").trim();
const jsonText = extractJson(text);
let parsed;
try {
  parsed = JSON.parse(jsonText);
} catch (e) {
  console.error("❌ Claude returned non-JSON. Raw output:\n", text);
  process.exit(1);
}

const reels = parsed.reels || parsed;
if (!Array.isArray(reels) || reels.length < 1) {
  console.error("❌ Parsed output has no reels. Raw:\n", text);
  process.exit(1);
}

// Validate, sanitize, sort by rank ascending
const clean = reels
  .map((r, i) => ({
    index: r.index ?? i + 1,
    title: String(r.title || "").trim(),
    hook: String(r.hook || "").trim().toUpperCase().slice(0, 44),
    startMs: Math.max(0, Math.floor(Number(r.startMs) || 0)),
    endMs: Math.max(0, Math.floor(Number(r.endMs) || 0)),
    format: r.format || "",
    flow: r.flow || null,
    retentionScore: Number(r.retentionScore) || 0,
    rank: Number(r.rank) || i + 1,
    reason: r.reason || "",
  }))
  .filter((r) => r.endMs - r.startMs >= 5000 && r.endMs - r.startMs <= 120000)
  .sort((a, b) => a.startMs - b.startMs);

writeJSON(path.join(episodeDir, "clips.json"), clean);
console.log(`✅ Saved ${clean.length} clips → ${path.join(episodeDir, "clips.json")}`);
console.log("\nTop 3 by rank:");
[...clean].sort((a, b) => a.rank - b.rank).slice(0, 3).forEach((r) => {
  console.log(`  #${r.rank} (${r.retentionScore}/10) [${fmtMs(r.startMs)}-${fmtMs(r.endMs)}]  ${r.hook}`);
});

function extractJson(text) {
  // Strip markdown fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) return text.slice(firstBrace, lastBrace + 1);
  return text;
}

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
