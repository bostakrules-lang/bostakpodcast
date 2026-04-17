import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

/**
 * Brand overlay for Biohack-it reels.
 *
 * Single PNG overlay (biohack-overlay.png) provided by Albert — contains
 * the bottom red gradient AND the "Biohack-it" wordmark, pre-rendered
 * with transparency. Dropped over every frame at full size.
 */
export const BiohackLogo: React.FC = () => {
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Img
        src={staticFile("biohack-overlay.png")}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </AbsoluteFill>
  );
};
