import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { usePlayer } from "@/context/PlayerContext";

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

interface TimeDisplayProps {
  horizontal?: boolean;
  compact?: boolean;
}

export default function TimeDisplay({ horizontal = false, compact = false }: TimeDisplayProps) {
  const { playbackPositionMs, playbackDurationMs } = usePlayer();

  if (compact) {
    return (
      <View style={styles.boxCompact}>
        <Text style={styles.compactCurrent}>{fmt(playbackPositionMs)}</Text>
        <Text style={styles.compactTotal}>{fmt(playbackDurationMs)}</Text>
      </View>
    );
  }

  if (horizontal) {
    return (
      <View style={styles.boxH}>
        <View style={styles.cell}>
          <Text style={styles.labelH}>POS</Text>
          <Text style={styles.current}>{fmt(playbackPositionMs)}</Text>
        </View>
        <View style={styles.dividerV} />
        <View style={styles.cell}>
          <Text style={styles.labelH}>DUR</Text>
          <Text style={styles.total}>{fmt(playbackDurationMs)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.current}>{fmt(playbackPositionMs)}</Text>
      <View style={styles.divider} />
      <Text style={styles.total}>{fmt(playbackDurationMs)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  boxCompact: {
    backgroundColor: "#16161e",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3a3a4a",
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "column",
    alignItems: "center",
    gap: 1,
  },
  compactCurrent: {
    color: "#64c8ff",
    fontFamily: "monospace",
    fontSize: 12,
    letterSpacing: 0.5,
    lineHeight: 15,
  },
  compactSep: {
    color: "#3a3a4a",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 15,
  },
  compactTotal: {
    color: "#7a98b8",
    fontFamily: "monospace",
    fontSize: 12,
    letterSpacing: 0.5,
    lineHeight: 15,
  },
  box: {
    backgroundColor: "#16161e",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3a3a4a",
    paddingHorizontal: 5,
    paddingVertical: 5,
    alignItems: "center",
    width: 46,
  },
  boxH: {
    backgroundColor: "#16161e",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3a3a4a",
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cell: {
    alignItems: "center",
    gap: 1,
  },
  labelH: {
    color: "#4a6a8a",
    fontFamily: "monospace",
    fontSize: 8,
    letterSpacing: 1,
    lineHeight: 10,
  },
  current: {
    color: "#64c8ff",
    fontFamily: "monospace",
    fontSize: 12,
    letterSpacing: 0.5,
    lineHeight: 15,
  },
  divider: {
    width: 28,
    height: 1,
    backgroundColor: "#3a3a4a",
    marginVertical: 2,
  },
  dividerV: {
    width: 1,
    height: 28,
    backgroundColor: "#3a3a4a",
  },
  total: {
    color: "#7a98b8",
    fontFamily: "monospace",
    fontSize: 12,
    letterSpacing: 0.5,
    lineHeight: 15,
  },
});
