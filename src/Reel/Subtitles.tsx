import { Caption, createTikTokStyleCaptions, TikTokPage } from "@remotion/captions";
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Sequence,
  useVideoConfig,
} from "remotion";

// Combine tokens within this window into a single "page" (subtitle line).
// 1200ms → groups 3-5 spoken words → matches natural breath/phrase pacing.
const SWITCH_CAPTIONS_EVERY_MS = 1200;
// Hide subtitles while the hook title is visible (hold 2s + fade 0.35s).
const HOOK_HIDE_UNTIL_MS = 2400;
// Small tail after the last token so the eye can finish reading it.
const TAIL_AFTER_LAST_TOKEN_MS = 220;

export const Subtitles: React.FC<{
  captions: Caption[];
  /** Hide subtitles from this frame onwards (e.g. during CTA window). */
  hideAfterFrame?: number;
}> = ({ captions, hideAfterFrame }) => {
  const { fps } = useVideoConfig();
  const { pages } = useMemo(
    () =>
      createTikTokStyleCaptions({
        combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
        captions: captions ?? [],
      }),
    [captions],
  );

  return (
    <>
      {pages.map((page, index) => {
        const next = pages[index + 1] ?? null;
        // Real end of the spoken phrase: either the next page's start, or the
        // last token's toMs plus a small tail (so the subtitle doesn't linger
        // through silences but also doesn't vanish mid-read).
        const lastTokenEndMs =
          page.tokens[page.tokens.length - 1]?.toMs ?? page.startMs;
        const naturalEndMs = lastTokenEndMs + TAIL_AFTER_LAST_TOKEN_MS;
        const rawEndMs = next
          ? Math.min(next.startMs, naturalEndMs)
          : naturalEndMs;

        // Page fully inside the hook window → skip.
        if (rawEndMs <= HOOK_HIDE_UNTIL_MS) return null;

        const effectiveStartMs = Math.max(page.startMs, HOOK_HIDE_UNTIL_MS);
        let startFrame = Math.round((effectiveStartMs / 1000) * fps);
        let endFrame = Math.round((rawEndMs / 1000) * fps);

        // Trim pages that extend into the CTA window; drop pages that start in it.
        if (hideAfterFrame !== undefined) {
          if (startFrame >= hideAfterFrame) return null;
          if (endFrame > hideAfterFrame) endFrame = hideAfterFrame;
        }

        const duration = endFrame - startFrame;
        if (duration <= 0) return null;
        return (
          <Sequence key={index} from={startFrame} durationInFrames={duration}>
            <SubtitlePage page={page} />
          </Sequence>
        );
      })}
    </>
  );
};

const SubtitlePage: React.FC<{ page: TikTokPage }> = ({ page }) => {
  // Hard cut — no spring, no fade, no slide.
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        // Raised ~180px higher than before (was 380) so subs sit in the
        // middle-lower band, clear of the Biohack-it wordmark.
        paddingBottom: 560,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          // Helvetica Neue stack. On headless Chrome (Linux) the render
          // resolves to Nimbus Sans, the open-source clone of Helvetica —
          // metrically identical glyphs, so the look is the same.
          fontFamily:
            '"Helvetica Neue", "HelveticaNeue", Helvetica, "Nimbus Sans", "Arial Black", Arial, sans-serif',
          fontWeight: 800,
          fontSize: 48,
          letterSpacing: "-0.3px",
          color: "#FFFFFF",
          // Soft drop shadow instead of thick stroke — cleaner, modern look.
          textShadow:
            "0 2px 4px rgba(0,0,0,0.85), 0 4px 14px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.9)",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "82%",
          lineHeight: 1.1,
          whiteSpace: "normal",
          overflowWrap: "break-word",
          wordBreak: "break-word",
        }}
      >
        {page.tokens.map((t, i) => (
          <span key={`${t.fromMs}-${i}`}>{t.text}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
