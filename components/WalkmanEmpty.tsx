import React from "react";
import { TouchableOpacity, useWindowDimensions } from "react-native";
import Svg, { Circle, Image as SvgImage, Line, Rect } from "react-native-svg";

interface WalkmanEmptyProps {
  onTap: () => void;
}

export default function WalkmanEmpty({ onTap }: WalkmanEmptyProps) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const svgW = 400;
  const svgH = 252;
  const maxW = isLandscape ? Math.min(width * 0.65, 520) : width - 24;
  const maxH = isLandscape ? height - 110 : height;
  const scaleW = maxW / svgW;
  const scaleH = maxH / svgH;
  const scale = isLandscape ? Math.min(scaleW, scaleH) : scaleW;
  const containerW = svgW * scale;
  const containerH = svgH * scale;

  return (
    <TouchableOpacity onPress={onTap} activeOpacity={0.92}>
      <Svg width={containerW} height={containerH} viewBox={`0 0 ${svgW} ${svgH}`}>
        {/* Outer body */}
        <Rect x={0} y={0} width={svgW} height={svgH} rx={12} ry={12} fill="#2d2d2d" stroke="#555" strokeWidth={2} />

        {/* Top label area (empty, no cassette) */}
        <Rect x={6} y={6} width={388} height={68} rx={6} ry={6} fill="#222230" />
        {/* NasoSan logo centered in label */}
        <SvgImage
          x={100}
          y={13}
          width={200}
          height={52}
          href={require("../assets/images/nasosan_logo.png")}
          preserveAspectRatio="xMidYMid meet"
        />

        {/* Corner screws */}
        {[[18, 20], [382, 20], [18, 232], [382, 232]].map(([cx, cy], i) => (
          <React.Fragment key={i}>
            <Circle cx={cx} cy={cy} r={6} fill="#444" stroke="#333" strokeWidth={1} />
            <Line x1={cx - 3} y1={cy} x2={cx + 3} y2={cy} stroke="#666" strokeWidth={1} />
            <Line x1={cx} y1={cy - 3} x2={cx} y2={cy + 3} stroke="#666" strokeWidth={1} />
          </React.Fragment>
        ))}

        {/* Reel window (empty dark) */}
        <Rect x={28} y={82} width={344} height={120} rx={8} ry={8} fill="#0a0a0a" />

        {/* Just the two spindle pins (perni) */}
        {/* Left spindle */}
        <Circle cx={130} cy={148} r={18} fill="#1a1a22" stroke="#3a3a4a" strokeWidth={2} />
        <Circle cx={130} cy={148} r={8} fill="#0d0d15" stroke="#4a4a5a" strokeWidth={1.5} />
        <Line x1={130} y1={140} x2={130} y2={156} stroke="#4a4a5a" strokeWidth={1.5} />
        <Line x1={122} y1={148} x2={138} y2={148} stroke="#4a4a5a" strokeWidth={1.5} />

        {/* Right spindle */}
        <Circle cx={270} cy={148} r={18} fill="#1a1a22" stroke="#3a3a4a" strokeWidth={2} />
        <Circle cx={270} cy={148} r={8} fill="#0d0d15" stroke="#4a4a5a" strokeWidth={1.5} />
        <Line x1={270} y1={140} x2={270} y2={156} stroke="#4a4a5a" strokeWidth={1.5} />
        <Line x1={262} y1={148} x2={278} y2={148} stroke="#4a4a5a" strokeWidth={1.5} />

        {/* Tape guides */}
        <Rect x={170} y={196} width={9} height={8} rx={2} fill="#333" />
        <Rect x={221} y={196} width={9} height={8} rx={2} fill="#333" />

        {/* Tape hole (empty) */}
        <Rect x={183} y={240} width={34} height={9} rx={3} ry={3} fill="#0a0a0a" />
      </Svg>
    </TouchableOpacity>
  );
}
