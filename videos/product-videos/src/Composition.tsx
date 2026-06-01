import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type ProductTourProps = {
  format: "landscape" | "square";
};

type Scene = {
  start: number;
  length: number;
  kicker: string;
  headline: string;
  detail: string;
  image: string;
  align: "left" | "right";
  zoom: number;
  panX: number;
  panY: number;
};

const scenes: Scene[] = [
  {
    start: 0,
    length: 96,
    kicker: "Codex native",
    headline: "Open the improvement cockpit from chat",
    detail: "Skill RSI turns a request into a local project handoff without starting paid model work.",
    image: "10-codex-setup-sidebar.png",
    align: "left",
    zoom: 1.05,
    panX: 0,
    panY: -18,
  },
  {
    start: 96,
    length: 96,
    kicker: "Live loop",
    headline: "Watch every experiment move through the pipeline",
    detail: "Runs expose stage progress, current evidence, and the exact project being improved.",
    image: "00-running-live.png",
    align: "right",
    zoom: 1.12,
    panX: -18,
    panY: -28,
  },
  {
    start: 192,
    length: 96,
    kicker: "Evidence first",
    headline: "Promotion decisions stay inspectable",
    detail: "Prompt-level results, judge rationale, and criteria scores sit beside the final verdict.",
    image: "06-evidence-prompt-expanded.png",
    align: "left",
    zoom: 1.08,
    panX: 18,
    panY: -26,
  },
  {
    start: 288,
    length: 96,
    kicker: "Controlled change",
    headline: "Compare candidates before a champion changes",
    detail: "Diffs make every challenger traceable, so the loop can keep useful wins and avoid repeats.",
    image: "08-candidate-compare.png",
    align: "right",
    zoom: 1.06,
    panX: -24,
    panY: -20,
  },
  {
    start: 384,
    length: 96,
    kicker: "Result",
    headline: "The winning skill returns to Codex",
    detail: "The sidebar keeps the champion, evidence, and next action visible beside the conversation.",
    image: "11-codex-result-sidebar-dark.png",
    align: "left",
    zoom: 1.02,
    panX: 14,
    panY: 0,
  },
];

const palette = {
  ink: "#eef3ff",
  muted: "#a8b1c7",
  line: "rgba(255, 255, 255, 0.14)",
  green: "#7df0b4",
  amber: "#f4c66a",
  coral: "#ff8f70",
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const localFrameFor = (frame: number, scene: Scene) => frame - scene.start;

const activeScene = (frame: number) => {
  return (
    scenes.find((scene) => frame >= scene.start && frame < scene.start + scene.length) ??
    scenes[scenes.length - 1]
  );
};

const sceneProgress = (frame: number, scene: Scene) => {
  return interpolate(localFrameFor(frame, scene), [0, scene.length], [0, 1], clamp);
};

const Background = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 480], [0, 1], clamp);

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(circle at 18% 18%, rgba(125, 240, 180, 0.18), transparent 28%), radial-gradient(circle at 82% 12%, rgba(255, 143, 112, 0.12), transparent 30%), linear-gradient(135deg, #080a0f 0%, #101523 46%, #17120f 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "78px 78px",
          transform: `translate(${drift * -34}px, ${drift * -26}px)`,
          opacity: 0.38,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, rgba(8,10,15,0.92), rgba(8,10,15,0.18) 52%, rgba(8,10,15,0.86))",
        }}
      />
    </AbsoluteFill>
  );
};

const SceneText = ({
  scene,
  layout,
}: {
  scene: Scene;
  layout: ReturnType<typeof getLayout>;
}) => {
  const frame = useCurrentFrame();
  const local = localFrameFor(frame, scene);
  const enter = interpolate(local, [0, 24], [0, 1], { ...clamp, easing: ease });
  const exit = interpolate(local, [scene.length - 12, scene.length], [1, 0], {
    ...clamp,
    easing: ease,
  });
  const opacity = enter * exit;
  const y = interpolate(enter, [0, 1], [32, 0], clamp);

  return (
    <div
      style={{
        width: layout.textWidth,
        opacity,
        transform: `translateY(${y}px)`,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          height: 42,
          padding: "0 18px",
          border: `1px solid ${palette.line}`,
          borderRadius: 999,
          background: "rgba(255,255,255,0.07)",
          color: palette.green,
          fontSize: layout.kickerSize,
          fontWeight: 760,
          textTransform: "uppercase",
          letterSpacing: 0,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 999,
            background: palette.amber,
            boxShadow: "0 0 24px rgba(244, 198, 106, 0.68)",
          }}
        />
        {scene.kicker}
      </div>
      <h1
        style={{
          margin: "30px 0 24px",
          color: palette.ink,
          fontSize: layout.headlineSize,
          lineHeight: 1.02,
          fontWeight: 820,
          letterSpacing: 0,
        }}
      >
        {scene.headline}
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: layout.detailWidth,
          color: palette.muted,
          fontSize: layout.detailSize,
          lineHeight: 1.36,
          fontWeight: 520,
          letterSpacing: 0,
        }}
      >
        {scene.detail}
      </p>
    </div>
  );
};

const ScreenshotFrame = ({
  scene,
  layout,
}: {
  scene: Scene;
  layout: ReturnType<typeof getLayout>;
}) => {
  const frame = useCurrentFrame();
  const local = localFrameFor(frame, scene);
  const enter = interpolate(local, [4, 32], [0, 1], { ...clamp, easing: ease });
  const exit = interpolate(local, [scene.length - 12, scene.length], [1, 0], {
    ...clamp,
    easing: ease,
  });
  const progress = sceneProgress(frame, scene);
  const opacity = enter * exit;
  const y = interpolate(enter, [0, 1], [42, 0], clamp);
  const scale = interpolate(progress, [0, 1], [scene.zoom, scene.zoom + 0.045], clamp);

  return (
    <div
      style={{
        width: layout.imageWidth,
        height: layout.imageHeight,
        opacity,
        transform: `translateY(${y}px) rotate(${scene.align === "left" ? 1.2 : -1.2}deg)`,
        borderRadius: layout.radius,
        padding: layout.framePadding,
        background: "linear-gradient(145deg, rgba(255,255,255,0.22), rgba(255,255,255,0.06))",
        border: `1px solid ${palette.line}`,
        boxShadow: "0 44px 120px rgba(0,0,0,0.48)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: layout.radius - 12,
          overflow: "hidden",
          background: "#0b0d12",
          position: "relative",
        }}
      >
        <Img
          src={staticFile(`product/${scene.image}`)}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale}) translate(${scene.panX * progress}px, ${scene.panY * progress}px)`,
          }}
        />
      </div>
    </div>
  );
};

const ProgressRail = ({ active }: { active: Scene }) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 86,
        right: 86,
        bottom: 58,
        height: 4,
        display: "grid",
        gridTemplateColumns: `repeat(${scenes.length}, 1fr)`,
        gap: 12,
      }}
    >
      {scenes.map((scene) => {
        const fill =
          scene === active
            ? interpolate(localFrameFor(frame, scene), [0, scene.length], [0, 100], clamp)
            : frame > scene.start
              ? 100
              : 0;

        return (
          <div
            key={scene.image}
            style={{
              height: 4,
              borderRadius: 999,
              overflow: "hidden",
              background: "rgba(255,255,255,0.16)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${fill}%`,
                background: `linear-gradient(90deg, ${palette.green}, ${palette.coral})`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

const getLayout = (format: ProductTourProps["format"], width: number) => {
  if (format === "square") {
    return {
      wrap: "column" as const,
      gap: 42,
      textWidth: 880,
      detailWidth: 780,
      imageWidth: 890,
      imageHeight: 520,
      headlineSize: 56,
      detailSize: 28,
      kickerSize: 17,
      radius: 30,
      framePadding: 12,
      paddingX: 86,
      paddingY: 86,
    };
  }

  return {
    wrap: "row" as const,
    gap: 88,
    textWidth: Math.min(610, width * 0.34),
    detailWidth: 560,
    imageWidth: Math.min(1010, width * 0.54),
    imageHeight: 640,
    headlineSize: 70,
    detailSize: 28,
    kickerSize: 18,
    radius: 34,
    framePadding: 14,
    paddingX: 100,
    paddingY: 96,
  };
};

export const ProductTour: React.FC<ProductTourProps> = ({ format }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const active = activeScene(frame);
  const layout = getLayout(format, width);
  const ordered = active.align === "left" ? ["text", "image"] : ["image", "text"];

  return (
    <AbsoluteFill style={{ color: palette.ink, overflow: "hidden" }}>
      <Background />
      <AbsoluteFill
        style={{
          padding: `${layout.paddingY}px ${layout.paddingX}px`,
          display: "flex",
          flexDirection: layout.wrap,
          alignItems: "center",
          justifyContent: "center",
          gap: layout.gap,
        }}
      >
        {ordered.map((part) => {
          if (part === "text") {
            return <SceneText key={`${active.image}-text`} scene={active} layout={layout} />;
          }

          return <ScreenshotFrame key={`${active.image}-image`} scene={active} layout={layout} />;
        })}
      </AbsoluteFill>
      <ProgressRail active={active} />
      <Sequence durationInFrames={36}>
        <IntroWash />
      </Sequence>
    </AbsoluteFill>
  );
};

const IntroWash = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 28, 36], [1, 0.18, 0], clamp);
  const scale = interpolate(frame, [0, 36], [1, 1.5], { ...clamp, easing: ease });

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        opacity,
        background: "radial-gradient(circle at 50% 50%, rgba(125,240,180,0.28), rgba(8,10,15,0.96) 55%)",
        transform: `scale(${scale})`,
      }}
    />
  );
};
