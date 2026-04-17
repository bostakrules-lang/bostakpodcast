import {
  AbsoluteFill,
  Audio,
  getStaticFiles,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Props = {
  handle: string;
  tagline?: string;
};

const CLICK_SFX = "sfx/click.mp3";
const hasClickSfx = () => getStaticFiles().some((f) => f.src.endsWith(CLICK_SFX));

/**
 * CTA overlay — Variant 01 from cta-minimal-preview.html.
 * White pill with red dot + @handle, tiny tagline above, macOS cursor taps it.
 * Runs once over its full sequence duration (typically 3s).
 */
export const CTAOverlay: React.FC<Props> = ({ handle, tagline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Convert seconds → frames
  const s = (x: number) => Math.round(x * fps);

  // Darken floor (bottom 45% of the frame) for pill legibility
  const floorOpacity = interpolate(frame, [0, s(0.3)], [0, 0.55], {
    extrapolateRight: "clamp",
  });

  // Pill enter: 0 → 0.55s
  const pillOpacity = interpolate(frame, [s(0.0), s(0.55)], [0, 1], {
    extrapolateRight: "clamp",
  });
  const pillRise = interpolate(frame, [s(0.0), s(0.55)], [14, 0], {
    extrapolateRight: "clamp",
  });

  // Tagline fades in 0.7 → 1.2
  const taglineOpacity = interpolate(frame, [s(0.7), s(1.2)], [0, 0.85], {
    extrapolateRight: "clamp",
  });

  // Cursor enters 1.0 → 1.8
  const cursorOpacity = interpolate(frame, [s(1.0), s(1.8)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorDX = interpolate(frame, [s(1.0), s(1.8)], [60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorDY = interpolate(frame, [s(1.0), s(1.8)], [-80, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Tap — cursor dip + pill invert, runs 2.0 → 2.6s
  // Tap phase: 0 → 1 (pressing), 1 → 0 (lifting)
  const tapDown = interpolate(frame, [s(2.0), s(2.15)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tapUp = interpolate(frame, [s(2.15), s(2.5)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pressed = Math.max(0, tapDown - tapUp); // 0→1→0
  const cursorTapOffset = pressed * -3;
  const cursorTapScale = 1 - 0.08 * pressed;

  // Pill inversion: lags tap slightly
  const invertProgress = interpolate(
    frame,
    [s(2.05), s(2.2), s(2.5), s(2.7)],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const pillBg = invertProgress > 0.5 ? "#111" : "#fff";
  const pillText = invertProgress > 0.5 ? "#fff" : "#111";
  const pillScale = 1 - 0.05 * pressed + 0.02 * Math.max(0, 1 - Math.abs(tapUp - 0.5) * 2) * 0;

  // Red dot scales slightly on press for extra life
  const dotScale = 1 + 0.15 * pressed;

  // Click SFX — plays at the moment the cursor presses the pill (~2.05s).
  const CLICK_AT_SEC = 2.05;

  return (
    <AbsoluteFill>
      {/* Click SFX synced with the tap */}
      {hasClickSfx() ? (
        <Sequence from={Math.round(CLICK_AT_SEC * fps)}>
          <Audio src={staticFile(CLICK_SFX)} volume={0.75} />
        </Sequence>
      ) : null}

      {/* bottom gradient for legibility */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "45%",
          background: `linear-gradient(180deg, transparent 0%, rgba(0,0,0,${floorOpacity}) 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* tagline */}
      {tagline ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 620,
            textAlign: "center",
            fontFamily:
              '"Helvetica Neue", "HelveticaNeue", Helvetica, "Nimbus Sans", Arial, sans-serif',
            fontSize: 30,
            letterSpacing: 10,
            textTransform: "uppercase",
            color: `rgba(255,255,255,${taglineOpacity})`,
            fontWeight: 500,
          }}
        >
          {tagline}
        </div>
      ) : null}

      {/* pill */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 460,
          transform: `translate(-50%, ${pillRise}px) scale(${pillScale})`,
          opacity: pillOpacity,
          background: pillBg,
          color: pillText,
          padding: "32px 72px",
          borderRadius: 9999,
          fontFamily:
            '"Helvetica Neue", "HelveticaNeue", Helvetica, "Nimbus Sans", Arial, sans-serif',
          fontWeight: 600,
          fontSize: 52,
          letterSpacing: 0.4,
          boxShadow:
            "0 18px 54px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.04)",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: 20,
          transition: "none",
        }}
      >
        {/* Profile avatar (biohack-it) — replaces the red dot. Instagram-like
            circle photo sitting next to the @handle. Scales slightly on tap. */}
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            overflow: "hidden",
            display: "inline-block",
            transform: `scale(${dotScale})`,
            boxShadow:
              "0 0 0 2px rgba(255,255,255,0.85), 0 4px 14px rgba(0,0,0,0.35)",
            flexShrink: 0,
          }}
        >
          <img
            src={staticFile("cta/biohack-avatar.jpg")}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </span>
        {handle}
      </div>

      {/* cursor — macOS arrow. Tip lands near right-center of the pill. */}
      <div
        style={{
          position: "absolute",
          // Base position: cursor tip (SVG upper-left) hovers over the "-it" of @biohack-it
          left: "50%",
          bottom: 500,
          width: 72,
          height: 72,
          opacity: cursorOpacity,
          transform: `translate(${70 + cursorDX + cursorTapOffset}px, ${
            cursorDY + cursorTapOffset
          }px) scale(${cursorTapScale})`,
          transformOrigin: "10% 10%",
          filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.85))",
        }}
      >
        <svg viewBox="0 0 24 24" width="72" height="72">
          <path
            d="M4 2 L4 18 L9 14 L12 21 L14.5 20 L11.5 13 L18 13 Z"
            fill="#fff"
            stroke="#000"
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </AbsoluteFill>
  );
};
