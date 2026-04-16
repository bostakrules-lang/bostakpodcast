import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { TheBoldFont } from "../load-font";

/**
 * Persistent red hook title at bottom of the reel.
 * Matches the Biohack-it reference reels: flat red (#E01621), bold uppercase,
 * tight padding, thin red vertical "stick" extending above the first line.
 */
export const HookTitle: React.FC<{
  readonly text: string;
}> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 130, mass: 0.6 },
    durationInFrames: 14,
  });

  // Show the hook only during the first 2s of the clip, then fade out.
  const holdUntil = Math.round(2 * fps); // 2s
  const fadeOutFrames = Math.round(0.35 * fps);
  const exitOpacity = interpolate(
    frame,
    [holdUntil, holdUntil + fadeOutFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const translateY = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]) * exitOpacity;

  // Don't render after fade-out ends — keeps the scene clean for the rest of the clip.
  if (frame > holdUntil + fadeOutFrames + 2) return null;

  const lines = splitIntoLines(text.toUpperCase(), 18);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 360,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${translateY}px)`,
          opacity,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 4,
          maxWidth: "92%",
          position: "relative",
        }}
      >
        {/* Thin red vertical "stick" extending above the box (decorative accent) */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: -70,
            width: 18,
            height: 70,
            background: "#E01621",
          }}
        />

        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              background: "#E01621",
              color: "#FFFFFF",
              fontFamily: TheBoldFont,
              fontWeight: 900,
              fontSize: 92,
              lineHeight: 1.0,
              letterSpacing: "-0.5px",
              padding: "12px 22px 16px 22px",
              textTransform: "uppercase",
              textAlign: "left",
              whiteSpace: "nowrap",
              alignSelf: "flex-start",
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Balance text into 1-2 lines on word boundaries. */
const splitIntoLines = (text: string, maxChars: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.join(" ").length <= maxChars) return [words.join(" ")];

  const total = words.join(" ").length;
  const target = total / 2;
  let best: [string[], string[]] = [words, []];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - target) + Math.abs(b.length - target);
    if (diff < bestDiff && a.length <= maxChars + 4 && b.length <= maxChars + 4) {
      best = [words.slice(0, i), words.slice(i)];
      bestDiff = diff;
    }
  }
  return [best[0].join(" "), best[1].join(" ")].filter(Boolean);
};
