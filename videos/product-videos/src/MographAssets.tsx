import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const duration = 180;

export const openingTitleDurationInFrames = 150;

export const mographAssets = [
  { id: "Asset01TrainingLossVsJudgment", component: Asset01TrainingLossVsJudgment, file: "01-training-loss-vs-judgment" },
  { id: "Asset02RecursiveSkillLoop", component: Asset02RecursiveSkillLoop, file: "02-recursive-skill-loop" },
  { id: "Asset03StartFromGoal", component: Asset03StartFromGoal, file: "03-start-from-goal" },
  { id: "Asset04SkillEvalToSkillRSI", component: Asset04SkillEvalToSkillRSI, file: "04-skilleval-to-skill-rsi" },
  { id: "Asset05ResearchBeforeWriting", component: Asset05ResearchBeforeWriting, file: "05-research-before-writing" },
  { id: "Asset06OntologyBuilder", component: Asset06OntologyBuilder, file: "06-ontology-builder" },
  { id: "Asset07AuthorityMap", component: Asset07AuthorityMap, file: "07-authority-map" },
  { id: "Asset08AdversarialReview", component: Asset08AdversarialReview, file: "08-adversarial-review" },
  { id: "Asset09AblationIteration", component: Asset09AblationIteration, file: "09-ablation-iteration" },
  { id: "Asset10CodexPluginHandoff", component: Asset10CodexPluginHandoff, file: "10-codex-plugin-handoff" },
  { id: "Asset11EvidenceZoomdown", component: Asset11EvidenceZoomdown, file: "11-evidence-zoomdown" },
  { id: "Asset12PromotionGate", component: Asset12PromotionGate, file: "12-promotion-gate" },
  { id: "Asset13VibesVsEvidence", component: Asset13VibesVsEvidence, file: "13-vibes-vs-evidence" },
  { id: "Asset14OntologySubwayMap", component: Asset14OntologySubwayMap, file: "14-ontology-subway-map" },
  { id: "Asset15RegressionShield", component: Asset15RegressionShield, file: "15-regression-shield" },
  { id: "Asset16TrustStack", component: Asset16TrustStack, file: "16-trust-stack" },
  { id: "Asset17DecisionTrace", component: Asset17DecisionTrace, file: "17-decision-trace" },
  { id: "Asset18AutonomousBounded", component: Asset18AutonomousBounded, file: "18-autonomous-bounded" },
  { id: "Asset19LightOntologyCards", component: Asset19LightOntologyCards, file: "19-light-ontology-cards" },
  { id: "Asset20LightScoreMatrix", component: Asset20LightScoreMatrix, file: "20-light-score-matrix" },
  { id: "Asset21LightExperimentNotebook", component: Asset21LightExperimentNotebook, file: "21-light-experiment-notebook" },
  { id: "Asset22LightSourceAudit", component: Asset22LightSourceAudit, file: "22-light-source-audit" },
  { id: "Asset23LightEvaluationBracket", component: Asset23LightEvaluationBracket, file: "23-light-evaluation-bracket" },
  { id: "Asset24LightMemoryArchive", component: Asset24LightMemoryArchive, file: "24-light-memory-archive" },
  { id: "Asset25LightTriggerModes", component: Asset25LightTriggerModes, file: "25-light-trigger-modes" },
  { id: "Asset26LightSkillPackageExploded", component: Asset26LightSkillPackageExploded, file: "26-light-skill-package-exploded" },
  { id: "Asset27LightJudgePanel", component: Asset27LightJudgePanel, file: "27-light-judge-panel" },
  { id: "Asset28LightOpenSourcePath", component: Asset28LightOpenSourcePath, file: "28-light-open-source-path" },
  { id: "Asset29LightPromptMicroscope", component: Asset29LightPromptMicroscope, file: "29-light-prompt-microscope" },
  { id: "Asset30LightBeforeAfterSkill", component: Asset30LightBeforeAfterSkill, file: "30-light-before-after-skill" },
] as const;

export const mographDurationInFrames = duration;

const palette = {
  ink: "#eef3ff",
  muted: "#a8b1c7",
  line: "rgba(255, 255, 255, 0.15)",
  panel: "rgba(12, 16, 26, 0.72)",
  green: "#7df0b4",
  amber: "#f4c66a",
  coral: "#ff8f70",
  blue: "#85b7ff",
  violet: "#b8a1ff",
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

const fade = (frame: number, start = 0, end = duration) => {
  const intro = interpolate(frame, [start, start + 22], [0, 1], { ...clamp, easing: ease });
  const outro = interpolate(frame, [end - 18, end], [1, 0], { ...clamp, easing: ease });
  return intro * outro;
};

const rise = (frame: number, start: number, amount = 28) =>
  interpolate(frame, [start, start + 28], [amount, 0], { ...clamp, easing: ease });

const appear = (frame: number, start: number, length = 24) =>
  interpolate(frame, [start, start + length], [0, 1], { ...clamp, easing: ease });

export function OpeningTitleBlack() {
  const frame = useCurrentFrame();
  const duration = openingTitleDurationInFrames;
  const globalFade = fade(frame, 0, duration);
  const iconIn = appear(frame, 16, 30);
  const iconScale = interpolate(frame, [16, 44, 72], [0.72, 1.08, 1], { ...clamp, easing: ease });
  const titleIn = appear(frame, 50, 26);
  const subtitleIn = appear(frame, 86, 24);
  const sweep = interpolate(frame, [18, 118], [-380, 980], clamp);
  const pulse = 0.5 + Math.sin(frame / 7) * 0.5;
  const title = "Skill RSI";

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background: "#030405",
        color: "#f7f7f2",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        opacity: globalFade,
      }}
    >
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 42%, rgba(136,201,143,0.16), transparent 25%), radial-gradient(circle at 58% 48%, rgba(240,173,85,0.12), transparent 20%), linear-gradient(180deg, rgba(255,255,255,0.035), transparent 42%)",
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "54px 54px",
          opacity: interpolate(frame, [0, 44, 130], [0, 0.28, 0.14], clamp),
          transform: `translateY(${interpolate(frame, [0, duration], [0, 36], clamp)}px)`,
        }}
      />
      {Array.from({ length: 18 }).map((_, index) => {
        const y = 114 + index * 48;
        const width = 120 + ((index * 47) % 360);
        const x = ((index * 181 + frame * (index % 2 ? 3 : -2)) % 2100) - 120;
        const active = appear(frame, 6 + index * 2, 18);
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width,
              height: 1,
              opacity: active * 0.34,
              background:
                index % 3 === 0
                  ? "linear-gradient(90deg, transparent, rgba(136,201,143,0.7), transparent)"
                  : "linear-gradient(90deg, transparent, rgba(240,173,85,0.48), transparent)",
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "43%",
          width: 520,
          height: 520,
          borderRadius: 999,
          transform: `translate(-50%, -50%) scale(${interpolate(frame, [20, 80], [0.82, 1.18], clamp)})`,
          opacity: interpolate(frame, [18, 72, 135], [0, 0.42, 0], clamp),
          background:
            "radial-gradient(circle, rgba(136,201,143,0.18), rgba(240,173,85,0.1) 38%, transparent 68%)",
          filter: "blur(4px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "38%",
          width: 218,
          height: 218,
          transform: `translate(-50%, -50%) scale(${iconScale}) rotate(${interpolate(frame, [12, 62], [-5, 0], { ...clamp, easing: ease })}deg)`,
          opacity: iconIn,
          filter: `drop-shadow(0 0 ${30 + pulse * 18}px rgba(136,201,143,0.42)) drop-shadow(0 0 70px rgba(240,173,85,0.18))`,
        }}
      >
        <Img
          src={staticFile("plugin/skill-rsi-icon.png")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            borderRadius: 44,
          }}
        />
      </div>
      {[0, 1].map((layer) => (
        <div
          key={layer}
          style={{
            position: "absolute",
            left: "50%",
            top: "61.5%",
            transform: `translate(-50%, -50%) translateX(${layer === 0 ? -3 : 3}px)`,
            opacity: titleIn * interpolate(frame, [50, 66, 78], [0.16, 0.28, 0], clamp),
            color: layer === 0 ? "#88c98f" : "#f0ad55",
            fontSize: 122,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: 0,
            whiteSpace: "nowrap",
            mixBlendMode: "screen",
          }}
        >
          {title}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "61%",
          display: "flex",
          gap: 7,
          transform: "translate(-50%, -50%)",
        }}
      >
        {title.split("").map((char, index) => {
          const charIn = appear(frame, 46 + index * 3, 18);
          const y = interpolate(frame, [46 + index * 3, 66 + index * 3], [38, 0], { ...clamp, easing: ease });
          const skew = interpolate(frame, [46 + index * 3, 66 + index * 3], [-10, 0], { ...clamp, easing: ease });
          return (
            <span
              key={`${char}-${index}`}
              style={{
                display: "inline-block",
                minWidth: char === " " ? 28 : undefined,
                opacity: charIn,
                color: "#f7f7f2",
                fontSize: 126,
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: 0,
                textShadow:
                  "0 0 28px rgba(247,247,242,0.18), 0 0 80px rgba(136,201,143,0.2), 0 20px 90px rgba(0,0,0,0.75)",
                transform: `translateY(${y}px) skewX(${skew}deg)`,
              }}
            >
              {char}
            </span>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "73%",
          width: 550,
          height: 1,
          transform: `translateX(-50%) scaleX(${interpolate(frame, [74, 102], [0, 1], { ...clamp, easing: ease })})`,
          opacity: subtitleIn,
          background: "linear-gradient(90deg, transparent, rgba(136,201,143,0.9), rgba(240,173,85,0.8), transparent)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "77%",
          transform: `translate(-50%, -50%) translateY(${interpolate(frame, [84, 112], [22, 0], { ...clamp, easing: ease })}px)`,
          opacity: subtitleIn,
          color: "rgba(247,247,242,0.74)",
          fontSize: 28,
          fontWeight: 760,
          lineHeight: 1.2,
          letterSpacing: 0,
          whiteSpace: "nowrap",
        }}
      >
        recursive skill improvement
      </div>
      <div
        style={{
          position: "absolute",
          left: sweep,
          top: 0,
          width: 230,
          height: "100%",
          opacity: interpolate(frame, [18, 42, 102, 124], [0, 0.5, 0.28, 0], clamp),
          background:
            "linear-gradient(90deg, transparent, rgba(136,201,143,0.08), rgba(247,247,242,0.22), rgba(240,173,85,0.08), transparent)",
          transform: "skewX(-18deg)",
          mixBlendMode: "screen",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 170px rgba(0,0,0,0.88)",
          border: "1px solid rgba(255,255,255,0.035)",
        }}
      />
    </AbsoluteFill>
  );
}

const Shell = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, duration], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ overflow: "hidden", color: palette.ink, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 18% 14%, rgba(125,240,180,0.17), transparent 28%), radial-gradient(circle at 84% 18%, rgba(255,143,112,0.13), transparent 30%), linear-gradient(135deg, #080a0f 0%, #101523 48%, #17120f 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "84px 84px",
          transform: `translate(${drift * -40}px, ${drift * -28}px)`,
          opacity: 0.34,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(90deg, rgba(8,10,15,0.92), rgba(8,10,15,0.2) 52%, rgba(8,10,15,0.88))",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 88,
          top: 64,
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: palette.green,
          fontSize: 18,
          fontWeight: 760,
          textTransform: "uppercase",
          letterSpacing: 0,
          opacity: 0.88,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 99, background: palette.amber, boxShadow: "0 0 22px rgba(244,198,106,0.7)" }} />
        {label}
      </div>
      {children}
    </AbsoluteFill>
  );
};

const Panel = ({
  x,
  y,
  w,
  h,
  children,
  opacity = 1,
  accent = palette.green,
  rotate = 0,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  children: React.ReactNode;
  opacity?: number;
  accent?: string;
  rotate?: number;
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      padding: 24,
      borderRadius: 24,
      border: `1px solid ${palette.line}`,
      background: `linear-gradient(145deg, ${palette.panel}, rgba(255,255,255,0.045))`,
      boxShadow: `0 32px 92px rgba(0,0,0,0.34), inset 0 0 0 1px ${accent}18`,
      opacity,
      transform: `rotate(${rotate}deg)`,
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

const BigLabel = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div
    style={{
      color: palette.ink,
      fontSize: 68,
      lineHeight: 1,
      fontWeight: 840,
      letterSpacing: 0,
      ...style,
    }}
  >
    {children}
  </div>
);

const Small = ({ children, color = palette.muted }: { children: React.ReactNode; color?: string }) => (
  <div style={{ color, fontSize: 25, lineHeight: 1.28, fontWeight: 620, letterSpacing: 0 }}>{children}</div>
);

const Chip = ({ children, color = palette.green }: { children: React.ReactNode; color?: string }) => (
  <div
    style={{
      display: "inline-flex",
      height: 42,
      alignItems: "center",
      padding: "0 18px",
      borderRadius: 999,
      border: `1px solid ${color}55`,
      color,
      background: `${color}16`,
      fontSize: 19,
      fontWeight: 760,
      letterSpacing: 0,
    }}
  >
    {children}
  </div>
);

const Line = ({ x1, y1, x2, y2, color = palette.green, opacity = 1 }: { x1: number; y1: number; x2: number; y2: number; color?: string; opacity?: number }) => (
  <svg style={{ position: "absolute", inset: 0, overflow: "visible", opacity }}>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray="10 14" />
  </svg>
);

const Node = ({ x, y, label, color = palette.green, scale = 1, opacity = 1 }: { x: number; y: number; label: string; color?: string; scale?: number; opacity?: number }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      minWidth: 150,
      height: 58,
      padding: "0 20px",
      borderRadius: 999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color,
      border: `1px solid ${color}55`,
      background: `${color}14`,
      fontSize: 20,
      fontWeight: 780,
      opacity,
      transform: `translate(-50%, -50%) scale(${scale})`,
      boxShadow: `0 0 44px ${color}18`,
    }}
  >
    {label}
  </div>
);

const Check = ({ text, active, y }: { text: string; active: number; y: number }) => (
  <div
    style={{
      position: "absolute",
      left: 34,
      top: y,
      display: "flex",
      alignItems: "center",
      gap: 16,
      opacity: active,
      transform: `translateX(${(1 - active) * -24}px)`,
    }}
  >
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: 99,
        background: palette.green,
        color: "#07100c",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 900,
      }}
    >
      ✓
    </span>
    <span style={{ color: palette.ink, fontSize: 24, fontWeight: 720 }}>{text}</span>
  </div>
);

const light = {
  ink: "#18202f",
  muted: "#657086",
  paper: "#f7f8fb",
  panel: "rgba(255, 255, 255, 0.84)",
  line: "rgba(24, 32, 47, 0.12)",
  green: "#198a5a",
  amber: "#b56f00",
  coral: "#c84f39",
  blue: "#2f6fd6",
  violet: "#7052c8",
};

const LightShell = ({ label, children }: { label: string; children: React.ReactNode }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, duration], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ overflow: "hidden", color: light.ink, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 16% 16%, rgba(25,138,90,0.14), transparent 31%), radial-gradient(circle at 86% 18%, rgba(47,111,214,0.11), transparent 32%), linear-gradient(135deg, #fbfcfe 0%, #eef2f7 48%, #fff7ef 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(24,32,47,0.052) 1px, transparent 1px), linear-gradient(90deg, rgba(24,32,47,0.052) 1px, transparent 1px)",
          backgroundSize: "78px 78px",
          transform: `translate(${drift * -28}px, ${drift * -18}px)`,
          opacity: 0.7,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 88,
          top: 64,
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: light.green,
          fontSize: 18,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 0,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 99, background: light.amber, boxShadow: "0 0 18px rgba(181,111,0,0.28)" }} />
        {label}
      </div>
      {children}
    </AbsoluteFill>
  );
};

const LightPanel = ({
  x,
  y,
  w,
  h,
  children,
  opacity = 1,
  accent = light.green,
  rotate = 0,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  children: React.ReactNode;
  opacity?: number;
  accent?: string;
  rotate?: number;
}) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      height: h,
      padding: 24,
      borderRadius: 22,
      border: `1px solid ${light.line}`,
      background: `linear-gradient(145deg, ${light.panel}, rgba(255,255,255,0.58))`,
      boxShadow: `0 24px 80px rgba(35, 43, 60, 0.13), inset 0 0 0 1px ${accent}18`,
      opacity,
      transform: `rotate(${rotate}deg)`,
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

const LightChip = ({ children, color = light.green }: { children: React.ReactNode; color?: string }) => (
  <div
    style={{
      display: "inline-flex",
      height: 40,
      alignItems: "center",
      padding: "0 16px",
      borderRadius: 999,
      border: `1px solid ${color}44`,
      color,
      background: `${color}10`,
      fontSize: 18,
      fontWeight: 800,
      letterSpacing: 0,
    }}
  >
    {children}
  </div>
);

const LightSmall = ({ children, color = light.muted }: { children: React.ReactNode; color?: string }) => (
  <div style={{ color, fontSize: 24, lineHeight: 1.28, fontWeight: 700, letterSpacing: 0 }}>{children}</div>
);

const LightBig = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ color: light.ink, fontSize: 64, lineHeight: 1.02, fontWeight: 860, letterSpacing: 0, ...style }}>{children}</div>
);

export function Asset01TrainingLossVsJudgment() {
  const frame = useCurrentFrame();
  const cardIn = appear(frame, 70);
  const points = [0, 24, 47, 69, 90, 112, 134, 154, 172];
  const values = [54, 78, 104, 128, 152, 174, 194, 214, 232];
  const path = points.map((x, i) => `${i === 0 ? "M" : "L"} ${x * 4.7 + 92} ${values[i] * 2.05 + 72}`).join(" ");
  const draw = interpolate(frame, [18, 92], [0, 1], clamp);

  return (
    <Shell label="better is a judgment">
      <Panel x={118} y={210} w={760} h={570} opacity={fade(frame)} accent={palette.blue}>
        <Chip color={palette.blue}>training loss</Chip>
        <svg width="710" height="410" style={{ position: "absolute", left: 28, top: 124 }}>
          {[0, 1, 2, 3].map((i) => (
            <line key={i} x1="54" x2="690" y1={70 + i * 86} y2={70 + i * 86} stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
          ))}
          <path d={path} stroke={palette.blue} strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray="900" strokeDashoffset={(1 - draw) * 900} />
          <circle cx={92 + 172 * 4.7} cy={54 * 2.05 + 72} r={12 + Math.sin(frame / 5) * 2} fill={palette.green} />
        </svg>
      </Panel>
      <div style={{ position: "absolute", left: 1010, top: 236, opacity: cardIn, transform: `translateY(${rise(frame, 70)})` }}>
        <BigLabel>Skills do not give you one clean number.</BigLabel>
      </div>
      {["prompt rationale", "criterion scores", "regression risk", "domain fit"].map((label, i) => {
        const a = appear(frame, 94 + i * 10);
        return (
          <Panel key={label} x={990 + (i % 2) * 330} y={500 + Math.floor(i / 2) * 142} w={296} h={104} opacity={a} accent={[palette.green, palette.amber, palette.coral, palette.violet][i]} rotate={(i - 1.5) * 1.2}>
            <Small color={palette.ink}>{label}</Small>
          </Panel>
        );
      })}
      <div style={{ position: "absolute", left: 1080, top: 850, opacity: appear(frame, 130) }}>
        <Chip color={palette.coral}>better is a judgment</Chip>
      </div>
    </Shell>
  );
}

export function Asset02RecursiveSkillLoop() {
  const frame = useCurrentFrame();
  const labels = ["research", "variant", "review", "evaluate", "promote", "remember"];
  const center = { x: 960, y: 540 };
  const r = 305;
  const sweep = interpolate(frame, [8, 160], [0, Math.PI * 2], clamp);

  return (
    <Shell label="recursive skill loop">
      <svg style={{ position: "absolute", inset: 0 }}>
        <circle cx={center.x} cy={center.y} r={r} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="4" />
        <circle cx={center.x + Math.cos(sweep - Math.PI / 2) * r} cy={center.y + Math.sin(sweep - Math.PI / 2) * r} r="16" fill={palette.green} />
      </svg>
      {labels.map((label, i) => {
        const angle = (i / labels.length) * Math.PI * 2 - Math.PI / 2;
        const active = Math.max(0.72, Math.sin(sweep - angle) * 0.28 + 0.82);
        return (
          <Node
            key={label}
            x={center.x + Math.cos(angle) * r}
            y={center.y + Math.sin(angle) * r}
            label={label}
            color={[palette.green, palette.blue, palette.amber, palette.violet, palette.coral, palette.green][i]}
            scale={active}
            opacity={fade(frame)}
          />
        );
      })}
      <Panel x={690} y={430} w={540} h={220} opacity={fade(frame, 20, 170)} accent={palette.green}>
        <BigLabel style={{ fontSize: 58, textAlign: "center" }}>one loop, one controlled change</BigLabel>
      </Panel>
    </Shell>
  );
}

export function Asset03StartFromGoal() {
  const frame = useCurrentFrame();
  const prompt = appear(frame, 10);
  const arrow = appear(frame, 74);
  const skill = appear(frame, 100);

  return (
    <Shell label="start from intention">
      <Panel x={140} y={260} w={650} h={340} opacity={prompt} accent={palette.amber}>
        <Chip color={palette.amber}>goal</Chip>
        <BigLabel style={{ fontSize: 50, marginTop: 38 }}>Help writers with screenplay craft.</BigLabel>
      </Panel>
      <Line x1={820} y1={430} x2={1080} y2={430} color={palette.green} opacity={arrow} />
      <div style={{ position: "absolute", left: 932, top: 380, opacity: arrow, fontSize: 62, color: palette.green, fontWeight: 900 }}>→</div>
      <Panel x={1110} y={222} w={650} h={430} opacity={skill} accent={palette.green}>
        <Chip>skill package</Chip>
        {["SKILL.md", "criteria", "test prompts", "evaluation notes"].map((label, i) => (
          <div key={label} style={{ marginTop: 28, height: 40, opacity: appear(frame, 112 + i * 9), color: i === 0 ? palette.ink : palette.muted, fontSize: 26, fontWeight: 760 }}>
            {label}
          </div>
        ))}
      </Panel>
      <div style={{ position: "absolute", left: 688, top: 730, opacity: appear(frame, 132) }}>
        <Chip color={palette.coral}>from scratch or existing skill</Chip>
      </div>
    </Shell>
  );
}

export function Asset04SkillEvalToSkillRSI() {
  const frame = useCurrentFrame();
  const bracket = appear(frame, 8);
  const loop = appear(frame, 92);

  return (
    <Shell label="SkillEval → Skill RSI">
      <Panel x={165} y={250} w={380} h={150} opacity={bracket} accent={palette.blue}>
        <BigLabel style={{ fontSize: 42 }}>Skill A</BigLabel>
      </Panel>
      <Panel x={165} y={560} w={380} h={150} opacity={bracket} accent={palette.coral}>
        <BigLabel style={{ fontSize: 42 }}>Skill B</BigLabel>
      </Panel>
      <Line x1={560} y1={325} x2={770} y2={480} color={palette.blue} opacity={bracket} />
      <Line x1={560} y1={635} x2={770} y2={480} color={palette.coral} opacity={bracket} />
      <Panel x={760} y={390} w={380} h={180} opacity={appear(frame, 54)} accent={palette.green}>
        <Chip>winner</Chip>
        <BigLabel style={{ fontSize: 42, marginTop: 28 }}>evidence</BigLabel>
      </Panel>
      <div style={{ position: "absolute", left: 1240, top: 312, opacity: loop, transform: `scale(${0.85 + loop * 0.15})` }}>
        <svg width="440" height="360">
          <circle cx="220" cy="180" r="128" fill="none" stroke={palette.green} strokeWidth="7" strokeDasharray={`${loop * 800} 800`} />
          <text x="220" y="164" fill={palette.ink} fontSize="44" fontWeight="840" textAnchor="middle">loop</text>
          <text x="220" y="212" fill={palette.muted} fontSize="24" fontWeight="720" textAnchor="middle">evaluate every round</text>
        </svg>
      </div>
    </Shell>
  );
}

export function Asset05ResearchBeforeWriting() {
  const frame = useCurrentFrame();
  const sources = ["source", "authority", "claim", "example", "failure mode"];

  return (
    <Shell label="research before writing">
      {sources.map((label, i) => {
        const a = appear(frame, 10 + i * 10);
        return (
          <Panel key={label} x={128 + i * 246} y={210 + (i % 2) * 82} w={210} h={130} opacity={a} accent={[palette.green, palette.amber, palette.blue, palette.violet, palette.coral][i]} rotate={(i - 2) * 1.4}>
            <Small color={palette.ink}>{label}</Small>
            <div style={{ marginTop: 22, height: 8, borderRadius: 99, background: "rgba(255,255,255,0.18)" }} />
            <div style={{ marginTop: 12, width: "70%", height: 8, borderRadius: 99, background: "rgba(255,255,255,0.12)" }} />
          </Panel>
        );
      })}
      <Line x1={500} y1={470} x2={960} y2={620} opacity={appear(frame, 72)} />
      <Panel x={590} y={580} w={740} h={270} opacity={appear(frame, 86)} accent={palette.green}>
        <Chip>distilled research packet</Chip>
        <BigLabel style={{ fontSize: 50, marginTop: 34 }}>write after the domain is mapped</BigLabel>
      </Panel>
    </Shell>
  );
}

export function Asset06OntologyBuilder() {
  const frame = useCurrentFrame();
  const nodes = [
    ["domain", 960, 520, palette.green],
    ["authorities", 620, 335, palette.amber],
    ["criteria", 1290, 330, palette.blue],
    ["failure modes", 610, 720, palette.coral],
    ["output patterns", 1315, 720, palette.violet],
  ] as const;

  return (
    <Shell label="ontology">
      {nodes.slice(1).map(([, x, y, color], i) => (
        <Line key={`${x}-${y}`} x1={960} y1={520} x2={x} y2={y} color={color} opacity={appear(frame, 55 + i * 12)} />
      ))}
      {nodes.map(([label, x, y, color], i) => (
        <Node key={label} x={x} y={y} label={label} color={color} opacity={appear(frame, 20 + i * 14)} scale={1 + Math.sin((frame + i * 11) / 18) * 0.03} />
      ))}
      <div style={{ position: "absolute", left: 705, top: 850, opacity: appear(frame, 114) }}>
        <Chip color={palette.green}>working map of good output</Chip>
      </div>
    </Shell>
  );
}

export function Asset07AuthorityMap() {
  const frame = useCurrentFrame();
  const sort = interpolate(frame, [78, 142], [0, 1], { ...clamp, easing: ease });
  const claims = [
    ["authority A", 260, 270, 860, 300, palette.blue],
    ["authority B", 250, 520, 1020, 520, palette.amber],
    ["authority C", 260, 770, 860, 750, palette.coral],
  ] as const;

  return (
    <Shell label="authority map">
      {claims.map(([label, x, y, tx, ty, color], i) => {
        const a = appear(frame, 16 + i * 12);
        return (
          <Panel key={label} x={interpolate(sort, [0, 1], [x, tx])} y={interpolate(sort, [0, 1], [y, ty])} w={300} h={120} opacity={a} accent={color}>
            <Small color={color}>{label}</Small>
            <div style={{ marginTop: 18, color: palette.ink, fontSize: 22, fontWeight: 720 }}>claim thread</div>
          </Panel>
        );
      })}
      <Panel x={1290} y={300} w={390} h={110} opacity={appear(frame, 102)} accent={palette.green}>
        <Small color={palette.green}>use</Small>
      </Panel>
      <Panel x={1290} y={490} w={390} h={110} opacity={appear(frame, 112)} accent={palette.amber}>
        <Small color={palette.amber}>contextual</Small>
      </Panel>
      <Panel x={1290} y={680} w={390} h={110} opacity={appear(frame, 122)} accent={palette.coral}>
        <Small color={palette.coral}>reject</Small>
      </Panel>
    </Shell>
  );
}

export function Asset08AdversarialReview() {
  const frame = useCurrentFrame();
  const scan = interpolate(frame, [34, 150], [238, 742], clamp);

  return (
    <Shell label="adversarial review">
      <Panel x={470} y={210} w={980} h={640} opacity={fade(frame)} accent={palette.blue}>
        <Chip color={palette.blue}>candidate skill</Chip>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} style={{ marginTop: 34, width: `${84 - i * 5}%`, height: 16, borderRadius: 99, background: "rgba(255,255,255,0.13)" }} />
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, top: scan - 210, height: 5, background: palette.green, boxShadow: "0 0 42px rgba(125,240,180,0.9)" }} />
      </Panel>
      <Panel x={1180} y={250} w={360} h={360} opacity={appear(frame, 70)} accent={palette.green}>
        <Check text="rigor" active={appear(frame, 76)} y={56} />
        <Check text="packaging" active={appear(frame, 92)} y={124} />
        <Check text="regressions" active={appear(frame, 108)} y={192} />
        <Check text="quality" active={appear(frame, 124)} y={260} />
      </Panel>
    </Shell>
  );
}

export function Asset09AblationIteration() {
  const frame = useCurrentFrame();
  const split = interpolate(frame, [48, 116], [0, 1], { ...clamp, easing: ease });

  return (
    <Shell label="ablation">
      <Panel x={interpolate(split, [0, 1], [650, 300])} y={270} w={500} h={430} opacity={fade(frame)} accent={palette.green}>
        <Chip>champion</Chip>
        {["prompt strategy", "rubric", "examples", "safety checks"].map((label, i) => (
          <div key={label} style={{ marginTop: 38, display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ color: i === 0 ? palette.amber : palette.green, fontSize: 24 }}>{i === 0 ? "●" : "🔒"}</span>
            <Small color={i === 0 ? palette.amber : palette.muted}>{label}</Small>
          </div>
        ))}
      </Panel>
      <Panel x={interpolate(split, [0, 1], [650, 1120])} y={270} w={500} h={430} opacity={split} accent={palette.coral}>
        <Chip color={palette.coral}>challenger</Chip>
        {["prompt strategy", "rubric", "examples", "safety checks"].map((label, i) => (
          <div key={label} style={{ marginTop: 38, display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ color: i === 0 ? palette.coral : palette.green, fontSize: 24 }}>{i === 0 ? "✦" : "🔒"}</span>
            <Small color={i === 0 ? palette.coral : palette.muted}>{label}</Small>
          </div>
        ))}
      </Panel>
      <div style={{ position: "absolute", left: 790, top: 780, opacity: appear(frame, 122) }}>
        <Chip color={palette.amber}>one variable moves</Chip>
      </div>
    </Shell>
  );
}

export function Asset10CodexPluginHandoff() {
  const frame = useCurrentFrame();
  const first = appear(frame, 8);
  const second = appear(frame, 76);
  const pan = interpolate(frame, [0, duration], [0, 26], clamp);

  return (
    <Shell label="Codex plugin">
      <Panel x={120} y={180} w={760} h={670} opacity={first} accent={palette.blue} rotate={-1}>
        <Img src={staticFile("product/10-codex-setup-sidebar.png")} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(1.08) translateX(${-pan}px)` }} />
      </Panel>
      <Panel x={1010} y={210} w={770} h={620} opacity={second} accent={palette.green} rotate={1}>
        <Img src={staticFile("product/00-running-live.png")} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(1.12) translateY(${-pan}px)` }} />
      </Panel>
      <div style={{ position: "absolute", left: 776, top: 500, opacity: appear(frame, 64), fontSize: 76, color: palette.green, fontWeight: 900 }}>→</div>
    </Shell>
  );
}

export function Asset11EvidenceZoomdown() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [40, 132], [1, 1.28], { ...clamp, easing: ease });
  const y = interpolate(frame, [40, 132], [0, -86], clamp);

  return (
    <Shell label="evidence">
      <Panel x={250} y={150} w={1420} h={760} opacity={fade(frame)} accent={palette.green}>
        <Img src={staticFile("product/06-evidence-prompt-expanded.png")} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom}) translateY(${y}px)` }} />
      </Panel>
      <Panel x={1160} y={648} w={460} h={150} opacity={appear(frame, 95)} accent={palette.amber}>
        <Chip color={palette.amber}>judge rationale</Chip>
        <Small color={palette.ink}>prompt-level evidence</Small>
      </Panel>
    </Shell>
  );
}

export function Asset12PromotionGate() {
  const frame = useCurrentFrame();
  const move = interpolate(frame, [24, 120], [0, 1], { ...clamp, easing: ease });

  return (
    <Shell label="promotion threshold">
      <Panel x={interpolate(move, [0, 1], [160, 680])} y={390} w={360} h={190} opacity={fade(frame)} accent={palette.coral}>
        <Chip color={palette.coral}>challenger</Chip>
        <BigLabel style={{ fontSize: 44, marginTop: 34 }}>candidate</BigLabel>
      </Panel>
      <div style={{ position: "absolute", left: 870, top: 236, width: 180, height: 620, borderLeft: `5px solid ${palette.green}`, borderRight: `5px solid ${palette.green}`, opacity: appear(frame, 42), boxShadow: "0 0 46px rgba(125,240,180,0.25)" }} />
      <Panel x={1120} y={285} w={520} h={410} opacity={appear(frame, 62)} accent={palette.green}>
        <Check text="wins by margin" active={appear(frame, 72)} y={70} />
        <Check text="breaks nothing" active={appear(frame, 94)} y={152} />
        <Check text="evidence usable" active={appear(frame, 116)} y={234} />
      </Panel>
      <Panel x={interpolate(move, [0.72, 1], [1180, 1320])} y={735} w={360} h={130} opacity={appear(frame, 128)} accent={palette.green}>
        <Chip>new champion</Chip>
      </Panel>
    </Shell>
  );
}

export function Asset13VibesVsEvidence() {
  const frame = useCurrentFrame();
  const clean = interpolate(frame, [48, 118], [0, 1], { ...clamp, easing: ease });
  const cloudOpacity = interpolate(clean, [0, 1], [1, 0.16], clamp);
  const labels = ["prompt", "rationale", "score", "diff", "regression"];

  return (
    <Shell label="evidence instead of vibes">
      <div
        style={{
          position: "absolute",
          left: 210,
          top: 300,
          width: 520,
          height: 320,
          opacity: cloudOpacity,
          filter: `blur(${interpolate(clean, [0, 1], [18, 4], clamp)}px)`,
          transform: `scale(${interpolate(clean, [0, 1], [1, 0.72], clamp)})`,
        }}
      >
        <div style={{ position: "absolute", left: 70, top: 80, width: 250, height: 160, borderRadius: 999, background: "rgba(184,161,255,0.32)" }} />
        <div style={{ position: "absolute", left: 210, top: 38, width: 220, height: 210, borderRadius: 999, background: "rgba(255,143,112,0.26)" }} />
        <div style={{ position: "absolute", left: 168, top: 150, width: 260, height: 150, borderRadius: 999, background: "rgba(125,240,180,0.2)" }} />
      </div>
      <div style={{ position: "absolute", left: 275, top: 654, opacity: interpolate(clean, [0, 1], [1, 0], clamp) }}>
        <Chip color={palette.violet}>vibes</Chip>
      </div>
      <Line x1={760} y1={500} x2={990} y2={500} color={palette.green} opacity={appear(frame, 64)} />
      <div style={{ position: "absolute", left: 882, top: 450, opacity: appear(frame, 72), fontSize: 62, color: palette.green, fontWeight: 900 }}>→</div>
      {labels.map((label, i) => {
        const a = appear(frame, 86 + i * 8);
        return (
          <Panel key={label} x={1030 + (i % 3) * 250} y={300 + Math.floor(i / 3) * 170} w={220} h={118} opacity={a} accent={[palette.green, palette.amber, palette.blue, palette.coral, palette.violet][i]}>
            <Small color={palette.ink}>{label}</Small>
          </Panel>
        );
      })}
      <div style={{ position: "absolute", left: 1138, top: 720, opacity: appear(frame, 132) }}>
        <BigLabel style={{ fontSize: 54 }}>evidence you can inspect</BigLabel>
      </div>
    </Shell>
  );
}

export function Asset14OntologySubwayMap() {
  const frame = useCurrentFrame();
  const draw = appear(frame, 24, 76);
  const stations = [
    ["domain", 390, 520, palette.green],
    ["audience", 610, 350, palette.amber],
    ["good output", 860, 520, palette.green],
    ["failure modes", 1120, 700, palette.coral],
    ["authorities", 1360, 350, palette.blue],
    ["tests", 1530, 520, palette.violet],
  ] as const;

  return (
    <Shell label="ontology subway map">
      <svg style={{ position: "absolute", inset: 0 }}>
        <path d="M390 520 C560 360, 710 340, 860 520 S1070 760, 1120 700 C1230 520, 1310 390, 1360 350 S1470 420, 1530 520" fill="none" stroke={palette.green} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${draw * 1800} 1800`} />
        <path d="M610 350 C740 440, 820 470, 860 520 C1010 500, 1180 430, 1360 350" fill="none" stroke={palette.blue} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${draw * 1200} 1200`} opacity={0.72} />
      </svg>
      {stations.map(([label, x, y, color], i) => (
        <Node key={label} x={x} y={y} label={label} color={color} opacity={appear(frame, 54 + i * 9)} scale={1 + Math.sin((frame + i * 8) / 16) * 0.025} />
      ))}
      <Panel x={720} y={780} w={520} h={120} opacity={appear(frame, 124)} accent={palette.green}>
        <Small color={palette.green}>the skill gets a map before it gets rewritten</Small>
      </Panel>
    </Shell>
  );
}

export function Asset15RegressionShield() {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 8) * 0.025;
  const strikes = [
    ["missing edge case", 300, 260, 760, 420, palette.coral],
    ["format drift", 300, 760, 760, 600, palette.amber],
    ["overfit", 1500, 300, 1170, 445, palette.violet],
  ] as const;

  return (
    <Shell label="regression shield">
      <Panel x={760} y={360} w={400} h={280} opacity={fade(frame)} accent={palette.green}>
        <Chip>champion behavior</Chip>
        <BigLabel style={{ fontSize: 48, marginTop: 38 }}>protect what already works</BigLabel>
      </Panel>
      <svg style={{ position: "absolute", inset: 0 }}>
        <circle cx="960" cy="500" r={260 * pulse} fill="none" stroke={palette.green} strokeWidth="5" opacity={appear(frame, 34) * 0.82} />
        <circle cx="960" cy="500" r={334 * pulse} fill="none" stroke={palette.green} strokeWidth="2" opacity={appear(frame, 54) * 0.42} strokeDasharray="16 18" />
      </svg>
      {strikes.map(([label, x, y, tx, ty, color], i) => {
        const a = appear(frame, 66 + i * 18);
        const hit = appear(frame, 96 + i * 18, 16);
        return (
          <div key={label}>
            <Line x1={x} y1={y} x2={interpolate(hit, [0, 1], [x, tx])} y2={interpolate(hit, [0, 1], [y, ty])} color={color} opacity={a} />
            <Panel x={x - 120} y={y - 55} w={240} h={90} opacity={a} accent={color}>
              <Small color={color}>{label}</Small>
            </Panel>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 820, top: 720, opacity: appear(frame, 130) }}>
        <Chip color={palette.green}>blocked before promotion</Chip>
      </div>
    </Shell>
  );
}

export function Asset16TrustStack() {
  const frame = useCurrentFrame();
  const layers = [
    ["sources", palette.blue],
    ["ontology", palette.green],
    ["adversarial review", palette.amber],
    ["head-to-head eval", palette.violet],
    ["history", palette.coral],
  ] as const;

  return (
    <Shell label="trust stack">
      {layers.map(([label, color], i) => {
        const a = appear(frame, 18 + i * 20);
        return (
          <Panel key={label} x={610} y={700 - i * 96} w={700} h={84} opacity={a} accent={color}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Small color={color}>{label}</Small>
              <div style={{ width: 130 + i * 42, height: 10, borderRadius: 99, background: `${color}88` }} />
            </div>
          </Panel>
        );
      })}
      <div style={{ position: "absolute", left: 690, top: 212, opacity: appear(frame, 126) }}>
        <BigLabel style={{ fontSize: 62 }}>trust is built in layers</BigLabel>
      </div>
    </Shell>
  );
}

export function Asset17DecisionTrace() {
  const frame = useCurrentFrame();
  const trace = appear(frame, 56, 70);
  const evidence = [
    ["prompt", 260, 260, palette.blue],
    ["rationale", 245, 520, palette.amber],
    ["score delta", 270, 780, palette.green],
    ["diff", 1220, 270, palette.violet],
    ["regression check", 1220, 720, palette.coral],
  ] as const;

  return (
    <Shell label="decision trace">
      <Panel x={745} y={405} w={430} h={220} opacity={fade(frame)} accent={palette.green}>
        <Chip>promotion</Chip>
        <BigLabel style={{ fontSize: 48, marginTop: 32 }}>why this won</BigLabel>
      </Panel>
      {evidence.map(([label, x, y, color], i) => (
        <div key={label}>
          <Panel x={x} y={y} w={330} h={110} opacity={appear(frame, 16 + i * 9)} accent={color}>
            <Small color={color}>{label}</Small>
          </Panel>
          <Line x1={x + 165} y1={y + 55} x2={960} y2={515} color={color} opacity={trace} />
        </div>
      ))}
      <div style={{ position: "absolute", left: 690, top: 720, opacity: appear(frame, 132) }}>
        <Chip color={palette.green}>every promotion has provenance</Chip>
      </div>
    </Shell>
  );
}

export function Asset18AutonomousBounded() {
  const frame = useCurrentFrame();
  const spin = interpolate(frame, [0, duration], [0, 360], clamp);
  const bounds = ["target iterations", "schedule", "thresholds"];

  return (
    <Shell label="autonomous, bounded">
      <div
        style={{
          position: "absolute",
          left: 390,
          top: 190,
          width: 1140,
          height: 680,
          borderRadius: 38,
          border: `2px solid ${palette.green}55`,
          boxShadow: "inset 0 0 70px rgba(125,240,180,0.08), 0 32px 120px rgba(0,0,0,0.34)",
          opacity: fade(frame),
        }}
      />
      <svg style={{ position: "absolute", inset: 0 }}>
        <circle cx="960" cy="505" r="170" fill="none" stroke={palette.green} strokeWidth="8" strokeDasharray="48 28" transform={`rotate(${spin} 960 505)`} opacity={0.84} />
        <circle cx="960" cy="505" r="98" fill="none" stroke={palette.amber} strokeWidth="4" strokeDasharray="20 18" transform={`rotate(${-spin * 1.4} 960 505)`} opacity={0.7} />
      </svg>
      <Panel x={760} y={400} w={400} h={210} opacity={appear(frame, 32)} accent={palette.green}>
        <BigLabel style={{ fontSize: 48, textAlign: "center" }}>runs on its own</BigLabel>
      </Panel>
      {bounds.map((label, i) => (
        <Panel key={label} x={500 + i * 330} y={730} w={280} h={110} opacity={appear(frame, 78 + i * 14)} accent={[palette.blue, palette.amber, palette.coral][i]}>
          <Small color={[palette.blue, palette.amber, palette.coral][i]}>{label}</Small>
        </Panel>
      ))}
    </Shell>
  );
}

export function Asset19LightOntologyCards() {
  const frame = useCurrentFrame();
  const cards = [
    ["domain", 250, 300, light.green],
    ["audience", 475, 210, light.amber],
    ["criteria", 760, 300, light.blue],
    ["failure modes", 1025, 210, light.coral],
    ["output patterns", 1300, 300, light.violet],
  ] as const;

  return (
    <LightShell label="light ontology cards">
      {cards.map(([label, x, y, color], i) => {
        const a = appear(frame, 14 + i * 12);
        return (
          <LightPanel key={label} x={x} y={y} w={220} h={136} opacity={a} accent={color} rotate={(i - 2) * 1.2}>
            <LightChip color={color}>{label}</LightChip>
            <div style={{ marginTop: 24, width: "82%", height: 9, borderRadius: 99, background: `${color}38` }} />
            <div style={{ marginTop: 12, width: "58%", height: 9, borderRadius: 99, background: "rgba(24,32,47,0.1)" }} />
          </LightPanel>
        );
      })}
      <Line x1={960} y1={520} x2={960} y2={680} color={light.green} opacity={appear(frame, 82)} />
      <LightPanel x={650} y={675} w={620} h={160} opacity={appear(frame, 100)} accent={light.green}>
        <LightBig style={{ fontSize: 48 }}>a working map before the rewrite</LightBig>
      </LightPanel>
    </LightShell>
  );
}

export function Asset20LightScoreMatrix() {
  const frame = useCurrentFrame();
  const rows = ["craft", "specificity", "format", "coverage", "safety"];
  const sweep = interpolate(frame, [34, 142], [0, rows.length], clamp);

  return (
    <LightShell label="score matrix">
      <LightPanel x={370} y={210} w={1180} h={650} opacity={fade(frame)} accent={light.blue}>
        <LightChip color={light.blue}>head-to-head eval</LightChip>
        <div style={{ position: "absolute", left: 340, top: 62, color: light.muted, fontSize: 22, fontWeight: 800 }}>champion</div>
        <div style={{ position: "absolute", left: 590, top: 62, color: light.muted, fontSize: 22, fontWeight: 800 }}>challenger</div>
        {rows.map((row, i) => {
          const active = sweep > i ? 1 : 0.28;
          const win = i !== 2;
          return (
            <div key={row} style={{ position: "absolute", left: 52, right: 52, top: 132 + i * 86, height: 54, display: "grid", gridTemplateColumns: "240px 220px 220px 1fr", alignItems: "center", opacity: active }}>
              <LightSmall color={light.ink}>{row}</LightSmall>
              <div style={{ width: 150, height: 12, borderRadius: 99, background: `${light.blue}${win ? "44" : "88"}` }} />
              <div style={{ width: win ? 180 : 132, height: 12, borderRadius: 99, background: `${win ? light.green : light.amber}99` }} />
              <LightChip color={win ? light.green : light.amber}>{win ? "wins" : "holds"}</LightChip>
            </div>
          );
        })}
      </LightPanel>
    </LightShell>
  );
}

export function Asset21LightExperimentNotebook() {
  const frame = useCurrentFrame();
  const entries = [
    ["hypothesis", "tighter task routing helps", light.blue],
    ["change", "one parameter moves", light.amber],
    ["result", "wins 4 of 5 prompts", light.green],
    ["next", "test edge cases", light.violet],
  ] as const;

  return (
    <LightShell label="experiment notebook">
      <LightPanel x={470} y={155} w={980} h={770} opacity={fade(frame)} accent={light.amber}>
        <LightChip color={light.amber}>loop record</LightChip>
        {entries.map(([label, text, color], i) => (
          <div key={label} style={{ position: "absolute", left: 68, right: 68, top: 132 + i * 140, opacity: appear(frame, 20 + i * 24), display: "grid", gridTemplateColumns: "190px 1fr", alignItems: "center" }}>
            <LightChip color={color}>{label}</LightChip>
            <LightBig style={{ fontSize: 42 }}>{text}</LightBig>
          </div>
        ))}
      </LightPanel>
    </LightShell>
  );
}

export function Asset22LightSourceAudit() {
  const frame = useCurrentFrame();
  const docs = ["source", "claim", "authority", "example"];

  return (
    <LightShell label="source audit">
      {docs.map((doc, i) => {
        const a = appear(frame, 10 + i * 14);
        return (
          <LightPanel key={doc} x={260 + i * 330} y={240 + (i % 2) * 120} w={260} h={340} opacity={a} accent={[light.blue, light.green, light.amber, light.violet][i]} rotate={(i - 1.5) * 1.6}>
            <LightChip color={[light.blue, light.green, light.amber, light.violet][i]}>{doc}</LightChip>
            {[0, 1, 2, 3].map((line) => (
              <div key={line} style={{ marginTop: 28, width: `${86 - line * 11}%`, height: 10, borderRadius: 99, background: "rgba(24,32,47,0.12)" }} />
            ))}
            <div style={{ position: "absolute", right: 24, bottom: 24, color: light.green, border: `2px solid ${light.green}`, borderRadius: 999, padding: "8px 13px", fontSize: 18, fontWeight: 900, opacity: appear(frame, 82 + i * 10) }}>
              verified
            </div>
          </LightPanel>
        );
      })}
    </LightShell>
  );
}

export function Asset23LightEvaluationBracket() {
  const frame = useCurrentFrame();
  const prompts = ["prompt 1", "prompt 2", "prompt 3"];

  return (
    <LightShell label="prompt bracket">
      {prompts.map((prompt, i) => (
        <LightPanel key={prompt} x={210} y={230 + i * 190} w={310} h={120} opacity={appear(frame, 14 + i * 12)} accent={light.blue}>
          <LightSmall color={light.blue}>{prompt}</LightSmall>
        </LightPanel>
      ))}
      <LightPanel x={770} y={250} w={300} h={160} opacity={appear(frame, 64)} accent={light.green}>
        <LightChip>skill A</LightChip>
        <LightBig style={{ fontSize: 44, marginTop: 28 }}>control</LightBig>
      </LightPanel>
      <LightPanel x={770} y={590} w={300} h={160} opacity={appear(frame, 76)} accent={light.coral}>
        <LightChip color={light.coral}>skill B</LightChip>
        <LightBig style={{ fontSize: 44, marginTop: 28 }}>treatment</LightBig>
      </LightPanel>
      <Line x1={535} y1={540} x2={740} y2={330} color={light.green} opacity={appear(frame, 92)} />
      <Line x1={535} y1={540} x2={740} y2={670} color={light.coral} opacity={appear(frame, 102)} />
      <LightPanel x={1280} y={420} w={360} h={180} opacity={appear(frame, 122)} accent={light.green}>
        <LightChip>winner</LightChip>
        <LightBig style={{ fontSize: 42, marginTop: 30 }}>evidence</LightBig>
      </LightPanel>
    </LightShell>
  );
}

export function Asset24LightMemoryArchive() {
  const frame = useCurrentFrame();
  const slide = interpolate(frame, [42, 124], [0, 1], { ...clamp, easing: ease });

  return (
    <LightShell label="memory archive">
      <LightPanel x={260} y={270} w={420} h={430} opacity={fade(frame)} accent={light.coral}>
        <LightChip color={light.coral}>dead ends</LightChip>
        {["too broad", "format drift", "weak eval"].map((item, i) => (
          <div key={item} style={{ marginTop: 46, opacity: appear(frame, 22 + i * 18), transform: `translateX(${slide * 620}px)` }}>
            <LightSmall color={light.coral}>{item}</LightSmall>
          </div>
        ))}
      </LightPanel>
      <LightPanel x={1120} y={270} w={480} h={430} opacity={appear(frame, 70)} accent={light.green}>
        <LightChip>history</LightChip>
        <LightBig style={{ fontSize: 46, marginTop: 66 }}>future loops avoid repeats</LightBig>
      </LightPanel>
      <Line x1={710} y1={480} x2={1090} y2={480} color={light.green} opacity={appear(frame, 90)} />
    </LightShell>
  );
}

export function Asset25LightTriggerModes() {
  const frame = useCurrentFrame();
  const modes = [
    ["manual", "set loops", light.blue],
    ["schedule", "run later", light.amber],
    ["hook", "react to context", light.green],
  ] as const;

  return (
    <LightShell label="run modes">
      {modes.map(([mode, detail, color], i) => (
        <LightPanel key={mode} x={315 + i * 445} y={340} w={360} h={300} opacity={appear(frame, 22 + i * 24)} accent={color}>
          <LightChip color={color}>{mode}</LightChip>
          <LightBig style={{ fontSize: 46, marginTop: 50 }}>{detail}</LightBig>
          <div style={{ position: "absolute", left: 24, right: 24, bottom: 34, height: 10, borderRadius: 99, background: `${color}66` }} />
        </LightPanel>
      ))}
    </LightShell>
  );
}

export function Asset26LightSkillPackageExploded() {
  const frame = useCurrentFrame();
  const layers = [
    ["SKILL.md", light.green],
    ["examples", light.blue],
    ["constraints", light.amber],
    ["rubric", light.violet],
    ["tests", light.coral],
  ] as const;
  const spread = interpolate(frame, [28, 128], [0, 1], { ...clamp, easing: ease });

  return (
    <LightShell label="skill package exploded">
      {layers.map(([label, color], i) => (
        <LightPanel key={label} x={690 + i * 18} y={interpolate(spread, [0, 1], [390, 210 + i * 120])} w={540} h={92} opacity={appear(frame, 16 + i * 9)} accent={color}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <LightSmall color={color}>{label}</LightSmall>
            <div style={{ width: 170, height: 10, borderRadius: 99, background: `${color}55` }} />
          </div>
        </LightPanel>
      ))}
    </LightShell>
  );
}

export function Asset27LightJudgePanel() {
  const frame = useCurrentFrame();
  const scores = ["specificity", "coverage", "faithfulness", "regression"];

  return (
    <LightShell label="judge panel">
      <LightPanel x={450} y={190} w={1020} h={700} opacity={fade(frame)} accent={light.violet}>
        <LightChip color={light.violet}>judge rationale</LightChip>
        <LightBig style={{ fontSize: 46, marginTop: 42 }}>Candidate B preserves structure and answers with stronger domain detail.</LightBig>
        {scores.map((score, i) => (
          <div key={score} style={{ marginTop: 38, opacity: appear(frame, 82 + i * 12), display: "grid", gridTemplateColumns: "230px 1fr 80px", alignItems: "center", gap: 20 }}>
            <LightSmall color={light.ink}>{score}</LightSmall>
            <div style={{ height: 12, borderRadius: 99, background: "rgba(24,32,47,0.1)", overflow: "hidden" }}>
              <div style={{ width: `${74 + i * 5}%`, height: "100%", background: [light.green, light.blue, light.amber, light.coral][i] }} />
            </div>
            <LightSmall color={[light.green, light.blue, light.amber, light.coral][i]}>{i === 3 ? "pass" : "win"}</LightSmall>
          </div>
        ))}
      </LightPanel>
    </LightShell>
  );
}

export function Asset28LightOpenSourcePath() {
  const frame = useCurrentFrame();
  const steps = [
    ["clone repo", light.blue],
    ["npm install", light.green],
    ["add API key", light.amber],
    ["open plugin", light.violet],
  ] as const;

  return (
    <LightShell label="open source path">
      {steps.map(([step, color], i) => {
        const a = appear(frame, 16 + i * 22);
        return (
          <div key={step}>
            <LightPanel x={230 + i * 390} y={420} w={300} h={150} opacity={a} accent={color}>
              <LightChip color={color}>{step}</LightChip>
            </LightPanel>
            {i < steps.length - 1 ? <Line x1={540 + i * 390} y1={495} x2={610 + i * 390} y2={495} color={light.green} opacity={appear(frame, 48 + i * 22)} /> : null}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 680, top: 690, opacity: appear(frame, 118) }}>
        <LightBig style={{ fontSize: 58 }}>local, inspectable, hackable</LightBig>
      </div>
    </LightShell>
  );
}

export function Asset29LightPromptMicroscope() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [38, 136], [0, 1], { ...clamp, easing: ease });

  return (
    <LightShell label="prompt microscope">
      <LightPanel x={300} y={220} w={1320} h={620} opacity={fade(frame)} accent={light.blue}>
        <LightChip color={light.blue}>prompt evidence</LightChip>
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} style={{ position: "absolute", left: 60, right: 60, top: 130 + row * 78, height: 52, borderRadius: 14, background: row === 2 ? `${light.green}18` : "rgba(24,32,47,0.055)", border: row === 2 ? `2px solid ${light.green}66` : `1px solid ${light.line}` }} />
        ))}
      </LightPanel>
      <div
        style={{
          position: "absolute",
          left: interpolate(zoom, [0, 1], [880, 1080]),
          top: interpolate(zoom, [0, 1], [442, 330]),
          width: interpolate(zoom, [0, 1], [170, 420]),
          height: interpolate(zoom, [0, 1], [170, 260]),
          borderRadius: 28,
          border: `4px solid ${light.green}`,
          boxShadow: "0 22px 70px rgba(25,138,90,0.25)",
          opacity: appear(frame, 48),
        }}
      />
      <LightPanel x={1110} y={620} w={440} h={140} opacity={appear(frame, 118)} accent={light.green}>
        <LightSmall color={light.green}>one prompt explains the verdict</LightSmall>
      </LightPanel>
    </LightShell>
  );
}

export function Asset30LightBeforeAfterSkill() {
  const frame = useCurrentFrame();
  const morph = interpolate(frame, [42, 132], [0, 1], { ...clamp, easing: ease });

  return (
    <LightShell label="before and after skill">
      <LightPanel x={260} y={250} w={520} h={520} opacity={fade(frame)} accent={light.coral}>
        <LightChip color={light.coral}>baseline</LightChip>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ marginTop: 44, width: `${90 - i * 13}%`, height: 12, borderRadius: 99, background: "rgba(24,32,47,0.12)" }} />
        ))}
      </LightPanel>
      <Line x1={820} y1={510} x2={1095} y2={510} color={light.green} opacity={appear(frame, 62)} />
      <LightPanel x={1120} y={250} w={540} h={520} opacity={appear(frame, 58)} accent={light.green}>
        <LightChip>champion</LightChip>
        {["intent routing", "domain criteria", "examples", "failure checks", "output contract"].map((label, i) => (
          <div key={label} style={{ marginTop: 34, opacity: interpolate(morph, [0, 1], [0.38, 1], clamp), display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ width: 12, height: 12, borderRadius: 99, background: [light.green, light.blue, light.amber, light.violet, light.coral][i] }} />
            <LightSmall color={light.ink}>{label}</LightSmall>
          </div>
        ))}
      </LightPanel>
    </LightShell>
  );
}
