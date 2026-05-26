import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { usePlayer } from "@/context/PlayerContext";
import TimeDisplay from "@/components/TimeDisplay";

interface BtnProps {
  onPress?: () => void;
  onLongPress?: () => void;
  active?: boolean;
  children: React.ReactNode;
  label?: string;
}

function Btn({ onPress, onLongPress, active, children, label }: BtnProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };
  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={onLongPress}
      delayLongPress={3000}
      activeOpacity={0.7}
      style={[styles.btn, active && styles.btnActive]}
    >
      {children}
      {label ? <Text style={[styles.label, active && styles.labelActive]}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

function formatCounter(current: number, total: number): string {
  if (total <= 0) return "0/0";
  const digits = total <= 9 ? 1 : total <= 99 ? 2 : total <= 999 ? 3 : 4;
  const cur = String(current + 1).padStart(digits, "0");
  const tot = String(total).padStart(digits, "0");
  return `${cur}/${tot}`;
}

export default function BottomRow() {
  const {
    shuffleMode,
    favoritesMode,
    toggleShuffle,
    regenerateShuffle,
    toggleFavorites,
    activeList,
    currentIndexInActive,
    showNoFavoritesMsg,
  } = usePlayer();

  return (
    <View style={styles.row}>
      {/* Shuffle */}
      <Btn onPress={toggleShuffle} onLongPress={regenerateShuffle} active={shuffleMode} label="SHUF">
        <Text style={[styles.icon, shuffleMode && styles.iconActive]}>{"⇄"}</Text>
      </Btn>

      {/* Favorites */}
      <Btn onPress={toggleFavorites} active={favoritesMode} label="FAV">
        <Text style={[styles.icon, favoritesMode && styles.iconActive]}>
          {favoritesMode ? "★" : "☆"}
        </Text>
      </Btn>

      {/* Timer — always visible between FAV and counter */}
      <TimeDisplay horizontal />

      {/* Counter */}
      <View style={styles.counter}>
        <Text style={styles.counterText}>
          {showNoFavoritesMsg
            ? "no fav"
            : formatCounter(currentIndexInActive, activeList.length)}
        </Text>
      </View>

      {/* Settings */}
      <Btn onPress={() => router.push("/settings")}>
        <Text style={styles.icon}>{"⚙"}</Text>
      </Btn>
    </View>
  );
}

const BTN_BASE = {
  backgroundColor: "#2a2a36",
  borderColor: "#4a4a5a",
  borderWidth: 1.5,
  borderRadius: 6,
  paddingHorizontal: 10,
  paddingVertical: 7,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  minWidth: 48,
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  btn: BTN_BASE,
  btnActive: {
    borderColor: "#64c8ff",
  },
  icon: {
    fontSize: 18,
    color: "#c8c8d2",
    lineHeight: 22,
  },
  iconActive: {
    color: "#64c8ff",
  },
  label: {
    color: "#8cc8ff",
    fontSize: 8,
    marginTop: 2,
    fontFamily: "monospace" as const,
  },
  labelActive: {
    color: "#64c8ff",
  },
  counter: {
    flex: 1,
    alignSelf: "stretch",
    backgroundColor: "#16161e",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3a3a4a",
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: "#64c8ff",
    fontFamily: "monospace" as const,
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 1,
    textAlign: "center",
  },
});
