import React, { useEffect, useRef, useState } from "react";
import { Animated, Linking, TouchableOpacity, useWindowDimensions } from "react-native";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Image as SvgImage,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

const APP_VERSION = "v.0.845";

interface CassetteProps {
  folderName: string;
  trackTitle: string;
  trackArtist: string;
  side: "A" | "B";
  sideProgress: number;
  isPlaying: boolean;
  isFavorite: boolean;
  isFF?: boolean;
  isRW?: boolean;
  stopCountdown?: number | null;
  onTap: () => void;
  onStarTap: () => void;
  onBadgeTap?: () => void;
  onTitleTap?: () => void;
  onArtistTap?: () => void;
}

function starPath(cx: number, cy: number, R: number, r: number): string {
  let d = "";
  const n = 5;
  for (let i = 0; i < n * 2; i++) {
    const radius = i % 2 === 0 ? R : r;
    const angle = (Math.PI / n) * i - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    d += (i === 0 ? "M" : "L") + `${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return d + "Z";
}

const HUB_R = 14;
const MAX_R = 46;
const MIN_WINDING_R = HUB_R + 4;

// SVG canvas size — extended bottom for taller lower body
const svgW = 400;
const svgH = 282;          // was 252 — extra 30px below
const leftCx = 130;
const rightCx = 270;
const reelCy = 148;
const tapeFloorY = 196;
// Bottom label position and size
const labelY = 207;
const labelH = 52;          // was 30 — ~1 cm taller

export default function CassetteSVG({
  folderName,
  trackTitle,
  trackArtist,
  side,
  sideProgress,
  isPlaying,
  isFavorite,
  isFF = false,
  isRW = false,
  stopCountdown = null,
  onTap,
  onStarTap,
  onBadgeTap,
  onTitleTap,
  onArtistTap,
}: CassetteProps) {
  const subPressedRef = React.useRef(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [leftAngle, setLeftAngle] = useState(0);
  const [rightAngle, setRightAngle] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressRef = useRef(sideProgress);

  const [displayedSide, setDisplayedSide] = useState<"A" | "B">(side);
  const flipAnim = useRef(new Animated.Value(1)).current;
  const prevSideRef = useRef(side);

  const [titleOffset, setTitleOffset] = useState(0);
  const [artistOffset, setArtistOffset] = useState(0);
  const titleAnimVal = useRef(new Animated.Value(0)).current;
  const artistAnimVal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progressRef.current = sideProgress;
  }, [sideProgress]);

  useEffect(() => {
    if (side !== prevSideRef.current) {
      prevSideRef.current = side;
      Animated.timing(flipAnim, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        setDisplayedSide(side);
        Animated.timing(flipAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }).start();
      });
    }
  }, [side, flipAnim]);

  useEffect(() => {
    const active = isPlaying || isFF || isRW;
    if (active) {
      intervalRef.current = setInterval(() => {
        if (isFF) {
          setLeftAngle(a => (a - 9 + 360) % 360);
          setRightAngle(a => (a - 9 + 360) % 360);
        } else if (isRW) {
          setLeftAngle(a => (a + 9) % 360);
          setRightAngle(a => (a + 9) % 360);
        } else {
          const p = Math.max(0, Math.min(1, progressRef.current));
          const rLeft = MIN_WINDING_R + (MAX_R - MIN_WINDING_R) * (1 - p);
          const rRight = MIN_WINDING_R + (MAX_R - MIN_WINDING_R) * p;
          const BASE = 128;
          setLeftAngle(a => (a - BASE / rLeft + 360) % 360);
          setRightAngle(a => (a - BASE / rRight + 360) % 360);
        }
      }, 50);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, isFF, isRW]);

  // Marquee for title text on red label
  useEffect(() => {
    // textX/textMaxX specchiati per lato A e B (uguale a render)
    const tx = displayedSide === "A" ? 42 + 10 : 54;
    const tmx = displayedSide === "A" ? svgW - 14 : svgW - 6 - 42 - 10;
    const CHAR_W = 10;
    const labelW = tmx - tx;
    const textW = trackTitle.length * CHAR_W;
    titleAnimVal.setValue(0);
    setTitleOffset(0);
    if (textW <= labelW) return;
    const dist = Math.ceil(textW - labelW + 30);
    const id = titleAnimVal.addListener(({ value }) => setTitleOffset(value));
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(titleAnimVal, { toValue: dist, duration: dist * 20, useNativeDriver: false }),
        Animated.delay(600),
        Animated.timing(titleAnimVal, { toValue: 0, duration: 0, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => { anim.stop(); titleAnimVal.removeListener(id); titleAnimVal.setValue(0); setTitleOffset(0); };
  }, [trackTitle, displayedSide, titleAnimVal]);

  // Marquee for artist text on red label
  useEffect(() => {
    const tx = displayedSide === "A" ? 42 + 10 : 54;
    const tmx = displayedSide === "A" ? svgW - 14 : svgW - 6 - 42 - 10;
    const CHAR_W = 8;
    const labelW = tmx - tx;
    const textW = trackArtist.length * CHAR_W;
    artistAnimVal.setValue(0);
    setArtistOffset(0);
    if (textW <= labelW) return;
    const dist = Math.ceil(textW - labelW + 30);
    const id = artistAnimVal.addListener(({ value }) => setArtistOffset(value));
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(1600),
        Animated.timing(artistAnimVal, { toValue: dist, duration: dist * 20, useNativeDriver: false }),
        Animated.delay(600),
        Animated.timing(artistAnimVal, { toValue: 0, duration: 0, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => { anim.stop(); artistAnimVal.removeListener(id); artistAnimVal.setValue(0); setArtistOffset(0); };
  }, [trackArtist, displayedSide, artistAnimVal]);

  const p = Math.max(0, Math.min(1, sideProgress));
  const leftWindingR = MIN_WINDING_R + (MAX_R - MIN_WINDING_R) * (1 - p);
  const rightWindingR = MIN_WINDING_R + (MAX_R - MIN_WINDING_R) * p;

  // Scale: fit within available width AND height in landscape
  const maxW = isLandscape ? Math.min(width * 0.62, 500) : Math.max(1, width - 24);
  const maxH = isLandscape ? Math.max(1, height - 110) : Math.max(1, height);
  const scaleW = maxW / svgW;
  const scaleH = maxH / svgH;
  const scale = Math.max(0.01, isLandscape ? Math.min(scaleW, scaleH) : scaleW);
  const containerW = svgW * scale;
  const containerH = svgH * scale;

  // ── Curved tape: exits from bottom tangent of each reel ──────────────────
  // Tape tangent point: 40% of winding radius horizontal offset from center
  const tapeFrac = 0.4;
  const lOffX = leftWindingR * tapeFrac;
  const lOffY = Math.sqrt(leftWindingR * leftWindingR - lOffX * lOffX);
  const tapeLX = leftCx - lOffX;           // slightly left of center of left reel
  const tapeLY = reelCy + lOffY;           // below center, on circle

  const rOffX = rightWindingR * tapeFrac;
  const rOffY = Math.sqrt(rightWindingR * rightWindingR - rOffX * rOffX);
  const tapeRX = rightCx + rOffX;
  const tapeRY = reelCy + rOffY;

  // Rounded corner radius at floor (Q bezier control = exact corner point)
  const cornerR = 14;
  const tapePath =
    `M ${tapeLX.toFixed(1)} ${tapeLY.toFixed(1)} ` +
    `Q ${tapeLX.toFixed(1)} ${tapeFloorY} ${(tapeLX + cornerR).toFixed(1)} ${tapeFloorY} ` +
    `L ${(tapeRX - cornerR).toFixed(1)} ${tapeFloorY} ` +
    `Q ${tapeRX.toFixed(1)} ${tapeFloorY} ${tapeRX.toFixed(1)} ${tapeRY.toFixed(1)}`;

  const starCx = displayedSide === "A" ? 372 : 28;
  const starCy = labelY + labelH * 0.5;

  // Folder name truncated (static label — no marquee needed)
  const folderText = folderName.length  > 13 ? folderName.substring(0, 12) + "…" : folderName;

  // Badge dimensions
  const badgeW = 42;
  // star for side B is at cx=28, r=18 → right edge at 46; add 8 margin → 54
  const textX = displayedSide === "A" ? badgeW + 10 : 54;
  const textMaxX = displayedSide === "A" ? svgW - 14 : svgW - 6 - badgeW - 10;

  return (
    <Animated.View style={{ transform: [{ scaleX: flipAnim }] }}>
    <TouchableOpacity
      onPress={() => { if (subPressedRef.current) { subPressedRef.current = false; return; } onTap(); }}
      activeOpacity={0.92}
    >
      <Svg width={containerW} height={containerH} viewBox={`0 0 ${svgW} ${svgH}`}>
        <Defs>
          <ClipPath id="titleClip">
            <Rect x={textX} y={labelY + 4} width={textMaxX - textX} height={labelH * 0.55} />
          </ClipPath>
          <ClipPath id="artistClip">
            <Rect x={textX} y={labelY + labelH * 0.52} width={textMaxX - textX} height={labelH * 0.42} />
          </ClipPath>
          <ClipPath id="reelWindow">
            <Rect x={28} y={82} width={344} height={120} />
          </ClipPath>
        </Defs>

        {/* Outer body */}
        <Rect x={0} y={0} width={svgW} height={svgH} rx={12} ry={12} fill="#2d2d2d" stroke="#555" strokeWidth={2} />

        {/* Top label (white) */}
        <Rect x={6} y={6} width={388} height={68} rx={6} ry={6} fill="#f0f0e8" />

        {/* Folder name — bold italic, large, centred left of NS icon */}
        <SvgText
          x={162}
          y={54}
          textAnchor="middle"
          fontSize={40}
          fontStyle="italic"
          fontWeight="bold"
          fontFamily="serif"
          fill="#1a1a1a"
        >
          {folderText}
        </SvgText>

        {/* Version number — to the left of the NS icon */}
        <SvgText
          x={309}
          y={57}
          textAnchor="end"
          fontSize={9}
          fontFamily="monospace"
          fill="#000000"
        >{APP_VERSION}</SvgText>

        {/* NS icon — top-right corner, shifted left */}
        <SvgImage
          x={316}
          y={10}
          width={52}
          height={52}
          href={require("../assets/images/ns_icon.png")}
          preserveAspectRatio="xMidYMid meet"
          onPress={() => Linking.openURL("https://www.nasosan.it")}
        />

        {/* Corner screws */}
        {([[18, 20], [382, 20], [18, 260], [382, 260]] as [number, number][]).map(([cx, cy], i) => (
          <React.Fragment key={i}>
            <Circle cx={cx} cy={cy} r={6} fill="#444" stroke="#333" strokeWidth={1} />
            <Line x1={cx - 3} y1={cy} x2={cx + 3} y2={cy} stroke="#666" strokeWidth={1} />
            <Line x1={cx} y1={cy - 3} x2={cx} y2={cy + 3} stroke="#666" strokeWidth={1} />
          </React.Fragment>
        ))}

        {/* Reel window */}
        <Rect x={28} y={82} width={344} height={120} rx={8} ry={8} fill="#0a0a0a" />

        {/* ── TAPE: curved U-shape from bottom of left reel → floor → bottom of right reel ── */}
        <G clipPath="url(#reelWindow)">
          <Path
            d={tapePath}
            stroke="#7B3A10"
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>

        {/* Left reel */}
        <G>
          <Circle cx={leftCx} cy={reelCy} r={leftWindingR} fill="#7B3A10" />
          <Circle cx={leftCx} cy={reelCy} r={HUB_R + 2} fill="#4a2008" />
          <G transform={`translate(${leftCx},${reelCy}) rotate(${leftAngle})`}>
            <Circle cx={0} cy={0} r={HUB_R} fill="#1e1e10" stroke="#64c8ff" strokeWidth={1.5} />
            <Line x1={0} y1={-(HUB_R)} x2={0} y2={HUB_R} stroke="#64c8ff" strokeWidth={1.5} />
            <Line x1={-(HUB_R)} y1={0} x2={HUB_R} y2={0} stroke="#64c8ff" strokeWidth={1.5} />
          </G>
        </G>

        {/* Right reel */}
        <G>
          <Circle cx={rightCx} cy={reelCy} r={rightWindingR} fill="#7B3A10" />
          <Circle cx={rightCx} cy={reelCy} r={HUB_R + 2} fill="#4a2008" />
          <G transform={`translate(${rightCx},${reelCy}) rotate(${rightAngle})`}>
            <Circle cx={0} cy={0} r={HUB_R} fill="#1e1e10" stroke="#64c8ff" strokeWidth={1.5} />
            <Line x1={0} y1={-(HUB_R)} x2={0} y2={HUB_R} stroke="#64c8ff" strokeWidth={1.5} />
            <Line x1={-(HUB_R)} y1={0} x2={HUB_R} y2={0} stroke="#64c8ff" strokeWidth={1.5} />
          </G>
        </G>

        {/* Stop countdown — tra le due bobine */}
        {stopCountdown != null && (
          <SvgText
            x={200}
            y={157}
            textAnchor="middle"
            fontSize={44}
            fontFamily="monospace"
            fontWeight="bold"
            fill="#64c8ff"
          >
            {String(stopCountdown)}
          </SvgText>
        )}

        {/* Tape guides */}
        <Rect x={170} y={196} width={9} height={8} rx={2} fill="#555" />
        <Rect x={221} y={196} width={9} height={8} rx={2} fill="#555" />

        {/* Bottom label (red) — taller now */}
        <Rect x={6} y={labelY} width={388} height={labelH} rx={4} ry={4} fill="#c8200a" />

        {displayedSide === "A" ? (
          <>
            {/* Side A badge */}
            <Rect x={6} y={labelY} width={badgeW} height={labelH} rx={0} fill="white" onPress={onBadgeTap} />
            <Rect x={6} y={labelY} width={10} height={labelH} rx={4} fill="white" />
            <SvgText x={6 + badgeW / 2} y={labelY + labelH * 0.65} textAnchor="middle" fontSize={22} fontWeight="bold" fill="#c8200a" onPress={onBadgeTap}>A</SvgText>
            {/* Track title */}
            <SvgText x={textX - titleOffset} y={labelY + labelH * 0.38} fontSize={16} fontStyle="italic" fontFamily="serif" fill="white" clipPath="url(#titleClip)">
              {trackTitle}
            </SvgText>
            {/* Artist */}
            <SvgText x={textX - artistOffset} y={labelY + labelH * 0.72} fontSize={11} fontFamily="monospace" fill="#ffcccc" clipPath="url(#artistClip)">
              {trackArtist}
            </SvgText>
            {/* Tappable overlays for inline editing */}
            <Rect x={textX} y={labelY + 2} width={textMaxX - textX} height={labelH * 0.46} fill="transparent" onPress={() => { subPressedRef.current = true; onTitleTap?.(); }} />
            <Rect x={textX} y={labelY + labelH * 0.50} width={textMaxX - textX} height={labelH * 0.44} fill="transparent" onPress={() => { subPressedRef.current = true; onArtistTap?.(); }} />
          </>
        ) : (
          <>
            {/* Track title */}
            <SvgText x={textX - titleOffset} y={labelY + labelH * 0.38} fontSize={16} fontStyle="italic" fontFamily="serif" fill="white" clipPath="url(#titleClip)">
              {trackTitle}
            </SvgText>
            {/* Artist */}
            <SvgText x={textX - artistOffset} y={labelY + labelH * 0.72} fontSize={11} fontFamily="monospace" fill="#ffcccc" clipPath="url(#artistClip)">
              {trackArtist}
            </SvgText>
            {/* Tappable overlays for inline editing */}
            <Rect x={textX} y={labelY + 2} width={textMaxX - textX} height={labelH * 0.46} fill="transparent" onPress={() => { subPressedRef.current = true; onTitleTap?.(); }} />
            <Rect x={textX} y={labelY + labelH * 0.50} width={textMaxX - textX} height={labelH * 0.44} fill="transparent" onPress={() => { subPressedRef.current = true; onArtistTap?.(); }} />
            {/* Side B badge */}
            <Rect x={svgW - 6 - badgeW} y={labelY} width={badgeW} height={labelH} rx={0} fill="white" onPress={() => { subPressedRef.current = true; onBadgeTap?.(); }} />
            <Rect x={svgW - 6 - 10} y={labelY} width={10} height={labelH} rx={4} fill="white" />
            <SvgText x={svgW - 6 - badgeW / 2} y={labelY + labelH * 0.65} textAnchor="middle" fontSize={22} fontWeight="bold" fill="#c8200a" onPress={() => { subPressedRef.current = true; onBadgeTap?.(); }}>B</SvgText>
          </>
        )}

        {/* Favorite star */}
        <Circle cx={starCx} cy={starCy} r={18} fill="transparent" onPress={() => { subPressedRef.current = true; onStarTap?.(); }} />
        <Path
          d={starPath(starCx, starCy, 11, 5)}
          fill={isFavorite ? "#64c8ff" : "none"}
          stroke="#64c8ff"
          strokeWidth={1.5}
          onPress={() => { subPressedRef.current = true; onStarTap?.(); }}
        />

        {/* Tape slot hole at bottom */}
        <Rect x={183} y={266} width={34} height={9} rx={3} ry={3} fill="#0a0a0a" />
      </Svg>
    </TouchableOpacity>
    </Animated.View>
  );
}
