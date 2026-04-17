import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Hook title shown during the first 2s of the reel.
 *
 * Biohack-it reference layout:
 *   - Helvetica Neue, all caps, heavy bold.
 *   - Only the key word gets a red box that SLIDES IN horizontally
 *     (left→right reveal), just like in the reference reels.
 *   - The rest is white with heavy drop shadow sitting directly over
 *     the video (no background panel around it).
 *   - Vertically centered in the safe area (not glued to the top).
 */
export const HookTitle: React.FC<{
  readonly text: string;
  readonly highlight?: string;
}> = ({ text, highlight }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --- Global enter (whole block) ---
  const enter = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 140, mass: 0.65 },
    durationInFrames: 14,
  });
  const translateY = interpolate(enter, [0, 1], [36, 0]);
  const blockOpacity = interpolate(enter, [0, 1], [0, 1]);

  // --- Red box slide reveal ---
  // The key word's red box slides in from left→right over ~18 frames
  // starting at frame 6 (after the block has started appearing).
  const slideStart = 6;
  const slideDur = 16;
  const slideProgress = interpolate(
    frame,
    [slideStart, slideStart + slideDur],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // --- Exit ---
  const holdUntil = Math.round(2 * fps);
  const fadeOutFrames = Math.round(0.35 * fps);
  const exitOpacity = interpolate(
    frame,
    [holdUntil, holdUntil + fadeOutFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = blockOpacity * exitOpacity;
  if (frame > holdUntil + fadeOutFrames + 2) return null;

  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const keyWord = pickKeyWord(words, highlight);
  const lines = layoutLines(words);

  const helvetica =
    '"Helvetica Neue", "HelveticaNeue", Helvetica, "Nimbus Sans", "Arial Black", Arial, sans-serif';

  return (
    <AbsoluteFill
      style={{
        // Slightly below vertical center, roughly 56% of the reel height.
        justifyContent: "center",
        alignItems: "center",
        paddingTop: 220,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px)`,
          opacity,
          maxWidth: "90%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        {lines.map((line, li) => (
          <div
            key={li}
            style={{
              display: "flex",
              flexWrap: "nowrap",
              justifyContent: "center",
              alignItems: "center",
              gap: 14,
              whiteSpace: "nowrap",
            }}
          >
            {line.map((w, wi) => {
              const isKey = w === keyWord;
              return (
                <span
                  key={`${li}-${wi}`}
                  style={{
                    position: "relative",
                    fontFamily: helvetica,
                    fontWeight: 900,
                    fontSize: 92,
                    lineHeight: 1.0,
                    letterSpacing: "-1px",
                    textTransform: "uppercase",
                    color: "#FFFFFF",
                    padding: isKey ? "4px 20px 10px 20px" : 0,
                    textShadow: isKey
                      ? "none"
                      : "0 3px 6px rgba(0,0,0,0.95), 0 6px 16px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,1)",
                    transform: isKey ? "translateY(-2px)" : "none",
                  }}
                >
                  {isKey ? (
                    <>
                      {/* Layer 1: white text with shadow, visible only where
                          the red box has NOT reached yet. */}
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          inset: 0,
                          padding: "4px 20px 10px 20px",
                          color: "#FFFFFF",
                          textShadow:
                            "0 3px 6px rgba(0,0,0,0.95), 0 6px 16px rgba(0,0,0,0.7), 0 0 2px rgba(0,0,0,1)",
                          clipPath: `inset(-30% 0 -30% ${slideProgress * 100}%)`,
                          WebkitClipPath: `inset(-30% 0 -30% ${
                            slideProgress * 100
                          }%)`,
                        }}
                      >
                        {w}
                      </span>
                      {/* Sliding red background — slides in left→right. */}
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "#E01621",
                          clipPath: `inset(0 ${(1 - slideProgress) * 100}% 0 0)`,
                          WebkitClipPath: `inset(0 ${
                            (1 - slideProgress) * 100
                          }% 0 0)`,
                        }}
                      />
                      {/* Layer 2: white text NO shadow, visible only where the
                          red box HAS reached (sits on top of the red). */}
                      <span
                        style={{
                          position: "relative",
                          display: "inline-block",
                          color: "#FFFFFF",
                          clipPath: `inset(-30% ${
                            (1 - slideProgress) * 100
                          }% -30% 0)`,
                          WebkitClipPath: `inset(-30% ${
                            (1 - slideProgress) * 100
                          }% -30% 0)`,
                        }}
                      >
                        {w}
                      </span>
                    </>
                  ) : (
                    <span style={{ position: "relative" }}>{w}</span>
                  )}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Pick the word to highlight. Prefer explicit match, else longest word. */
const pickKeyWord = (words: string[], highlight?: string): string => {
  if (highlight) {
    const up = highlight.toUpperCase();
    const hit = words.find((w) => w === up);
    if (hit) return hit;
  }
  const candidates = words.filter((w) => w.length >= 3);
  const pool = candidates.length ? candidates : words;
  return pool.reduce((a, b) => (b.length > a.length ? b : a), pool[0] ?? "");
};

/** Balance a word list into 1 or 2 lines so each fits within ~16 characters. */
const layoutLines = (words: string[]): string[][] => {
  const joined = words.join(" ");
  if (joined.length <= 16) return [words];
  const total = joined.length;
  const target = total / 2;
  let best: [string[], string[]] = [words, []];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - target) + Math.abs(b.length - target);
    if (diff < bestDiff) {
      best = [words.slice(0, i), words.slice(i)];
      bestDiff = diff;
    }
  }
  return [best[0], best[1]].filter((l) => l.length);
};
