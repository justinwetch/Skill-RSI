import "./index.css";
import { Composition } from "remotion";
import { ProductTour } from "./Composition";
import {
  mographAssets,
  mographDurationInFrames,
  OpeningTitleBlack,
  openingTitleDurationInFrames,
} from "./MographAssets";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="OpeningTitleBlack"
        component={OpeningTitleBlack}
        durationInFrames={openingTitleDurationInFrames}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="ProductTourLandscape"
        component={ProductTour}
        durationInFrames={480}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          format: "landscape" as const,
        }}
      />
      <Composition
        id="ProductTourSquare"
        component={ProductTour}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1080}
        defaultProps={{
          format: "square" as const,
        }}
      />
      {mographAssets.map((asset) => (
        <Composition
          key={asset.id}
          id={asset.id}
          component={asset.component}
          durationInFrames={mographDurationInFrames}
          fps={30}
          width={1920}
          height={1080}
        />
      ))}
    </>
  );
};
