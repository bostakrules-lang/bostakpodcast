import React from "react";
import {
  AbsoluteFill,
  Img,
  getStaticFiles,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Brand overlay for Biohack-it reels.
 *
 * Two elements (matches the reference reels):
 * 1. A big red serif "B" watermark anchored bottom-left, partially
 *    off-screen, semi-transparent — present the entire clip.
 * 2. A centered white Biohack-it wordmark on the opening ~1.5s intro
 *    (only if biohack-logo.png exists in public/).
 */
export const BiohackLogo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const hasLogo = getStaticFiles().some((f) => f.src.endsWith("biohack-logo.png"));
  const hasCornerB = getStaticFiles().some((f) => f.src.endsWith("biohack-b.png"));

  // Intro overlay lives from frame 0 → 1.5s with a fade-out
  const introDurationFrames = Math.round(1.5 * fps);
  const introOpacity = interpolate(
    frame,
    [0, 6, introDurationFrames - 8, introDurationFrames],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Bottom-left decorative "B" — matches reference reels */}
      {hasCornerB ? (
        <Img
          src={staticFile("biohack-b.png")}
          style={{
            position: "absolute",
            left: -40,
            bottom: -40,
            width: 320,
            height: "auto",
            opacity: 0.7,
          }}
        />
      ) : (
        <CornerB />
      )}

      {/* Intro: centered white Biohack-it wordmark on the first 1.5s */}
      {hasLogo && frame < introDurationFrames ? (
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            opacity: introOpacity,
          }}
        >
          <Img
            src={staticFile("biohack-logo.png")}
            style={{
              width: "62%",
              height: "auto",
              objectFit: "contain",
              filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.45))",
            }}
          />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Fallback decorative "B" when biohack-b.png is not provided.
 * Red serif italic, partly off-screen, semi-transparent.
 */
const CornerB: React.FC = () => {
  return (
    <div
      style={{
        position: "absolute",
        left: -40,
        bottom: -60,
        fontFamily: '"Playfair Display", "Georgia", serif',
        fontStyle: "italic",
        fontWeight: 700,
        fontSize: 380,
        color: "#C81019",
        opacity: 0.75,
        lineHeight: 1,
        textShadow: "0 0 8px rgba(0,0,0,0.2)",
      }}
    >
      B
    </div>
  );
};
