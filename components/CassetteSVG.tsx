// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, TouchableOpacity, View, useWindowDimensions } from "react-native";
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

import { APP_VERSION_DISPLAY } from "@/constants/app";
import { C } from "@/constants/colors";

const REEL_OUTER = "#7B3A10";
const REEL_INNER = "#4a2008";
const HUB_FILL   = "#1e1e10";
const TAPE_COLOR  = "#3a1808"; // distinto da C.tapeColor (#1a1200) — divergenza voluta per design
const CASSETTE_TEXT = "#1a1a1a";

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

// SVG canvas = image dimensions
const svgW = 518;
const svgH = 323;

// Reel window
const RWX = 42;
const RWY = 104;
const RWW = 434;
const RWH = 154;

// Reel centers and radii
const leftCx = 146.6;
const rightCx = 363;
const leftCy = 139;
const rightCy = 138;
const HUB_R = 35;
const MAX_R = 113;
const MIN_WINDING_R = 48;

// Tape guides
const GUIDE_Y = RWY + RWH - 18;
const GUIDE_LX = 228;
const GUIDE_RX = 282;

// Track title — striscia bianca cassetta (Y≈210-255)
const HOLES_TOP = RWY + RWH + 4;       // = 262
const HOLES_CLIP_X = RWX + 8;          // = 50 (quasi bordo sinistro cassetta)
const HOLES_CLIP_W = RWW - 16;         // = 418 (quasi tutta la larghezza cassetta)
const TITLE_CLIP_H = 28;
const ARTIST_CLIP_H = 24;
const TITLE_CLIP_Y = 198;              // 3mm sotto
const TITLE_TEXT_Y = 213;              // TITLE_CLIP_Y + 15
const ARTIST_CLIP_Y = 244;             // striscia bianca, sotto titolo
const ARTIST_TEXT_Y = 260;             // ARTIST_CLIP_Y + 16

// A/B badge — fixed bottom left
const BADGE_X = 22;
const BADGE_Y = svgH - 23;             // = 300 (0.5cm up)

// Star — fixed bottom right, +100% (R 10→20, r 4→8), centro sale e va sx
const STAR_CX = svgW - 42;             // = 476 (bottom-right fisso a 496)
const STAR_CY_POS = svgH - 42;         // = 281 (bottom-right fisso a 301)

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
  const titleAnimVal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    progressRef.current = sideProgress;
  }, [sideProgress]);

  useEffect(() => {
    if (side !== prevSideRef.current) {
      prevSideRef.current = side;
      Animated.timing(flipAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setDisplayedSide(side);
        Animated.timing(flipAnim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
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
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, isFF, isRW]);

  // Marquee titolo nella holes area
  useEffect(() => {
    const CHAR_W = 11;
    const textW = trackTitle.length * CHAR_W;
    titleAnimVal.setValue(0);
    setTitleOffset(0);
    if (textW <= HOLES_CLIP_W) return;
    const dist = Math.ceil(textW - HOLES_CLIP_W + 20);
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
  }, [trackTitle, titleAnimVal]);


  const p = Math.max(0, Math.min(1, sideProgress));
  const leftWindingR = MIN_WINDING_R + (MAX_R - MIN_WINDING_R) * (1 - p);
  const rightWindingR = MIN_WINDING_R + (MAX_R - MIN_WINDING_R) * p;

  const maxW = isLandscape ? Math.min(width * 0.62, 500) : Math.max(1, width - 24);
  const maxH = isLandscape ? Math.max(1, height - 110) : Math.max(1, height);
  const scaleW = maxW / svgW;
  const scaleH = maxH / svgH;
  const scale = Math.max(0.01, isLandscape ? Math.min(scaleW, scaleH) : scaleW);
  const containerW = svgW * scale;
  const containerH = svgH * scale;

  const folderText = folderName.length > 9 ? folderName.substring(0, 8) + "…" : folderName;
  const containerStyle = useMemo(() => ({ width: containerW, height: containerH }), [containerW, containerH]);

  return (
    <View style={containerStyle}>
    <Animated.View style={{ transform: [{ scaleX: flipAnim }] }}>
      <TouchableOpacity
        onPress={() => { if (subPressedRef.current) { subPressedRef.current = false; return; } onTap(); }}
        activeOpacity={0.92}
      >
        <Svg width={containerW} height={containerH} viewBox={`0 0 ${svgW} ${svgH}`}>
          <Defs>
            <ClipPath id="titleClip">
              <Rect x={HOLES_CLIP_X} y={TITLE_CLIP_Y} width={HOLES_CLIP_W} height={TITLE_CLIP_H} />
            </ClipPath>
          </Defs>

          {/* Dark background reel window — sotto le bobine */}
          <Rect x={RWX} y={RWY} width={RWW} height={RWH} rx={8} fill={C.reelWindow} />

          {/* Left reel */}
          <Circle cx={leftCx} cy={leftCy} r={leftWindingR} fill={REEL_OUTER} />
          <Circle cx={leftCx} cy={leftCy} r={HUB_R + 2} fill={REEL_INNER} />
          <G transform={`translate(${leftCx},${leftCy}) rotate(${leftAngle})`}>
            <Circle cx={0} cy={0} r={HUB_R} fill={HUB_FILL} stroke={C.accent} strokeWidth={1.5} />
            <Line x1={0} y1={-HUB_R} x2={0} y2={HUB_R} stroke={C.accent} strokeWidth={1.5} />
            <Line x1={-HUB_R} y1={0} x2={HUB_R} y2={0} stroke={C.accent} strokeWidth={1.5} />
          </G>

          {/* Right reel */}
          <Circle cx={rightCx} cy={rightCy} r={rightWindingR} fill={REEL_OUTER} />
          <Circle cx={rightCx} cy={rightCy} r={HUB_R + 2} fill={REEL_INNER} />
          <G transform={`translate(${rightCx},${rightCy}) rotate(${rightAngle})`}>
            <Circle cx={0} cy={0} r={HUB_R} fill={HUB_FILL} stroke={C.accent} strokeWidth={1.5} />
            <Line x1={0} y1={-HUB_R} x2={0} y2={HUB_R} stroke={C.accent} strokeWidth={1.5} />
            <Line x1={-HUB_R} y1={0} x2={HUB_R} y2={0} stroke={C.accent} strokeWidth={1.5} />
          </G>

          {/* Nastro: tratta sinistra bobina→guida sx (X dinamica, Y clamped) */}
          <Line
            x1={Math.min(leftCx + leftWindingR * 0.6, 213)}
            y1={Math.min(leftCy + leftWindingR * 0.15, 163)}
            x2={216}
            y2={163}
            stroke={TAPE_COLOR}
            strokeWidth={6}
          />
          {/* Guide nastro sx */}
          <Rect x={216} y={158} width={5} height={10} rx={2} fill="#666" />
          {/* Nastro: striscia orizzontale nella finestra trasparente centrale */}
          <Rect x={218} y={160} width={66} height={7} rx={1} fill={TAPE_COLOR} />
          {/* Guide nastro dx */}
          <Rect x={284} y={158} width={5} height={10} rx={2} fill="#666" />
          {/* Nastro: tratta destra guida dx→bobina (X dinamica, Y clamped) */}
          <Line
            x1={290}
            y1={163}
            x2={Math.max(rightCx - rightWindingR * 0.6, 297)}
            y2={Math.min(rightCy + rightWindingR * 0.15, 163)}
            stroke={TAPE_COLOR}
            strokeWidth={6}
          />

          {/* Cassetta PNG — sopra bobine, finestre ovali trasparenti mostrano animazione */}
          <SvgImage
            x={0} y={0} width={svgW} height={svgH}
            href={require("../assets/images/cassetta_base.png")}
            preserveAspectRatio="xMidYMid meet"
          />

          {/* Titolo cassetta — font corsivo inclinato scrittura umana */}
          <SvgText
            x={195}
            y={74}
            textAnchor="middle"
            fontSize={68}
            fontStyle="italic"
            fontWeight="bold"
            fontFamily="cursive"
            fill={CASSETTE_TEXT}
            transform="rotate(-10, 195, 74)"
          >
            {folderText}
          </SvgText>

          {/* Numero versione */}
          <SvgText
            x={402}
            y={87}
            textAnchor="middle"
            fontSize={27}
            fontFamily="monospace"
            fill="#333333"
          >
            {APP_VERSION_DISPLAY}
          </SvgText>

          {/* Logo NS — allineato al nome cassetta, destra */}
          <SvgImage
            x={421}
            y={101}
            width={42}
            height={42}
            href={require("../assets/images/ns_icon.png")}
            preserveAspectRatio="xMidYMid meet"
            onPress={() => Linking.openURL("https://www.nasosan.it")}
          />


          {/* Titolo brano con scorrimento */}
          <SvgText
            x={HOLES_CLIP_X - titleOffset}
            y={TITLE_TEXT_Y}
            fontSize={22}
            fontStyle="italic"
            fontFamily="serif"
            fill={CASSETTE_TEXT}
            clipPath="url(#titleClip)"
          >
            {trackTitle}
          </SvgText>

          {/* Tap overlay titolo */}
          <Rect
            x={HOLES_CLIP_X} y={TITLE_CLIP_Y} width={HOLES_CLIP_W} height={TITLE_CLIP_H}
            fill="transparent"
            onPress={() => { subPressedRef.current = true; onTitleTap?.(); }}
          />

          {/* Stop countdown — sopra tutto */}
          {stopCountdown != null && (
            <SvgText
              x={(leftCx + rightCx) / 2}
              y={136 + 16}
              textAnchor="middle"
              fontSize={44}
              fontFamily="monospace"
              fontWeight="bold"
              fill={C.accent}
            >
              {String(stopCountdown)}
            </SvgText>
          )}

          {/* Badge A/B — angolo in basso a sx fisso, cresce in alto a dx (+50%) */}
          <Rect x={BADGE_X - 6} y={BADGE_Y - 45} width={48} height={51} rx={5} fill="transparent" />
          <SvgText
            x={BADGE_X + 18}
            y={BADGE_Y}
            textAnchor="middle"
            fontSize={45}
            fontWeight="bold"
            fill={C.accent}
          >
            {displayedSide}
          </SvgText>
          {/* Tap overlay badge */}
          <Rect
            x={BADGE_X - 6} y={BADGE_Y - 45} width={48} height={51}
            fill="transparent"
            onPress={() => { subPressedRef.current = true; onBadgeTap?.(); }}
          />

          {/* Stella — angolo in basso a dx fisso, +100% */}
          <Circle
            cx={STAR_CX} cy={STAR_CY_POS} r={36}
            fill="transparent"
            onPress={() => { subPressedRef.current = true; onStarTap?.(); }}
          />
          <Path
            d={starPath(STAR_CX, STAR_CY_POS, 20, 8)}
            fill={isFavorite ? C.accent : "none"}
            stroke={C.accent}
            strokeWidth={1.5}
            onPress={() => { subPressedRef.current = true; onStarTap?.(); }}
          />
        </Svg>
      </TouchableOpacity>
    </Animated.View>
    </View>
  );
}
