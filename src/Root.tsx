import { Composition, staticFile } from "remotion";
import {
  CaptionedVideo,
  calculateCaptionedVideoMetadata,
  captionedVideoSchema,
} from "./CaptionedVideo";
import { Reel, reelSchema, calculateReelMetadata } from "./Reel";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main Biohack-it reel composition (9:16) */}
      <Composition
        id="Reel"
        component={Reel}
        calculateMetadata={calculateReelMetadata}
        schema={reelSchema}
        width={1080}
        height={1920}
        defaultProps={{
          src: "sample-video.mp4",
          hook: "THE WINDOW OF OPPORTUNITY",
          music: undefined,
          musicVolume: 0.15,
        }}
      />

      {/* Legacy captioned video for reference */}
      <Composition
        id="CaptionedVideo"
        component={CaptionedVideo}
        calculateMetadata={calculateCaptionedVideoMetadata}
        schema={captionedVideoSchema}
        width={1080}
        height={1920}
        defaultProps={{
          src: staticFile("sample-video.mp4"),
        }}
      />
    </>
  );
};
