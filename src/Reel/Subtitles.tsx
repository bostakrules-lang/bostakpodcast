import { Caption, createTikTokStyleCaptions, TikTokPage } from "@remotion/captions";
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TheBoldFont } from "../load-font";

// ~2-3 words at a time: fast, readable, matches reference reels.
const SWITCH_CAPTIONS_EVERY_MS = 750;

export const Subtitles: React.FC<{ captions: Caption[] }> = ({ captions }) => {
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
        const startFrame = Math.round((page.startMs / 1000) * fps);
        const endFrame = Math.min(
          next ? Math.round((next.startMs / 1000) * fps) : Infinity,
          startFrame + Math.round((SWITCH_CAPTIONS_EVERY_MS / 1000) * fps),
        );
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
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 4,
  });

  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const translateY = interpolate(enter, [0, 1], [16, 0]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 380, // TikTok-style bottom-third band (hook is gone after 2s)
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px)`,
          opacity,
          fontFamily: TheBoldFont,
          fontWeight: 900,
          fontSize: 60,
          letterSpacing: "-0.5px",
          color: "#FFFFFF",
          WebkitTextStroke: "8px #000000",
          paintOrder: "stroke fill",
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "80%",
          lineHeight: 1.08,
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
