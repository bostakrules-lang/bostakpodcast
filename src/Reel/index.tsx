import { Caption } from "@remotion/captions";
import { getVideoMetadata } from "@remotion/media-utils";
import { useCallback, useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  CalculateMetadataFunction,
  cancelRender,
  getStaticFiles,
  OffthreadVideo,
  Sequence,
  staticFile,
  useDelayRender,
  useVideoConfig,
  watchStaticFile,
} from "remotion";
import { z } from "zod";
import { loadFont } from "../load-font";
import { BiohackLogo } from "./BiohackLogo";
import { CTAOverlay } from "./CTAOverlay";
import { HookTitle } from "./HookTitle";
import { Subtitles } from "./Subtitles";

export const reelSchema = z.object({
  // Path to the clip (e.g. `clips/clip-01.mp4`) — must live in public/
  src: z.string(),
  // CTR hook title shown in red gradient box for entire clip
  hook: z.string(),
  // Which word of the hook to highlight with a red box (case-insensitive).
  hookHighlight: z.string().optional(),
  // Optional background music track (public/music/…)
  music: z.string().optional(),
  // Background music volume (0-1). Default 0.15 so it doesn't cover voice.
  musicVolume: z.number().optional(),
  // Seconds into the music track to start playback (for climax sync).
  musicStartSec: z.number().optional(),
  // CTA overlay shown on the final N seconds.
  cta: z
    .object({
      handle: z.string(),
      tagline: z.string().optional(),
      durationSec: z.number().optional(),
    })
    .optional(),
});

export const calculateReelMetadata: CalculateMetadataFunction<
  z.infer<typeof reelSchema>
> = async ({ props }) => {
  const fps = 30;
  const metadata = await getVideoMetadata(
    props.src.startsWith("http") ? props.src : staticFile(props.src),
  );
  return {
    fps,
    durationInFrames: Math.floor(metadata.durationInSeconds * fps),
  };
};

const captionsFileFor = (src: string) =>
  src
    .replace(/\.mp4$/, ".json")
    .replace(/\.mkv$/, ".json")
    .replace(/\.mov$/, ".json")
    .replace(/\.webm$/, ".json");

const staticFileExists = (relPath: string) =>
  getStaticFiles().some((f) => f.src.endsWith(relPath));

export const Reel: React.FC<z.infer<typeof reelSchema>> = ({
  src,
  hook,
  hookHighlight,
  music,
  musicVolume,
  musicStartSec,
  cta,
}) => {
  const { fps, durationInFrames } = useVideoConfig();
  const [captions, setCaptions] = useState<Caption[]>([]);
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender());

  const captionsPath = captionsFileFor(src);

  const fetchCaptions = useCallback(async () => {
    try {
      await loadFont();
      const res = await fetch(staticFile(captionsPath));
      if (!res.ok) {
        // No captions yet (dev preview); continue anyway
        setCaptions([]);
        continueRender(handle);
        return;
      }
      const data = (await res.json()) as Caption[];
      setCaptions(data);
      continueRender(handle);
    } catch (e) {
      cancelRender(e);
    }
  }, [continueRender, handle, captionsPath]);

  useEffect(() => {
    fetchCaptions();
    const c = watchStaticFile(captionsPath, () => fetchCaptions());
    return () => c.cancel();
  }, [captionsPath, fetchCaptions]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      {/* Background video, object-fit cover for 9:16 crop */}
      <AbsoluteFill>
        <OffthreadVideo
          src={staticFile(src)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>

      {/* Biohack-it logo + B corners */}
      <BiohackLogo />

      {/* Hook title — keyword highlighted in red box, rest white over video */}
      {hook ? <HookTitle text={hook} highlight={hookHighlight} /> : null}

      {/* Word-by-word subtitles — hidden during CTA window for clean composition */}
      <Subtitles
        captions={captions}
        hideAfterFrame={
          cta
            ? Math.max(0, durationInFrames - Math.floor((cta.durationSec ?? 3) * fps))
            : undefined
        }
      />

      {/* Optional background music (ducked under voice) */}
      {music && staticFileExists(music) ? (
        <Audio
          src={staticFile(music)}
          volume={musicVolume ?? 0.15}
          startFrom={Math.floor((musicStartSec ?? 0) * fps)}
        />
      ) : null}

      {/* CTA overlay on the final N seconds */}
      {cta ? (
        (() => {
          const ctaFrames = Math.floor((cta.durationSec ?? 3) * fps);
          const from = Math.max(0, durationInFrames - ctaFrames);
          return (
            <Sequence from={from} durationInFrames={ctaFrames}>
              <CTAOverlay handle={cta.handle} tagline={cta.tagline} />
            </Sequence>
          );
        })()
      ) : null}
    </AbsoluteFill>
  );
};
