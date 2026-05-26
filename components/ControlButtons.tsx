import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { usePlayer } from "@/context/PlayerContext";
import { initSounds, playSound, SoundName } from "@/utils/SoundManager";

interface BtnProps {
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  children: React.ReactNode;
  green?: boolean;
  style?: object;
  sound?: SoundName;
}

function Btn({ onPress, onPressIn, onPressOut, children, green, style, sound = "click" }: BtnProps) {
  const trigger = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSound(sound);
  };

  return (
    <TouchableOpacity
      onPress={onPress ? () => { trigger(); onPress(); } : undefined}
      onPressIn={onPressIn ? () => { trigger(); onPressIn(); } : undefined}
      onPressOut={onPressOut}
      activeOpacity={0.7}
      style={[styles.btn, green && styles.btnPlay, style]}
    >
      {children}
    </TouchableOpacity>
  );
}

export default function ControlButtons({ large = false }: { large?: boolean }) {
  const { play, pause, stop, next, prev, startFF, stopFF, startRW, stopRW, isPlaying } = usePlayer();

  useEffect(() => {
    initSounds();
  }, []);

  const bigBtn: object = large ? { paddingHorizontal: 18, paddingVertical: 16, minWidth: 56 } : {};
  const bigIcon: object = large ? { fontSize: 28, lineHeight: 34 } : {};
  const bigIconPlay: object = large ? { fontSize: 32, lineHeight: 38 } : {};
  const bigPlayBtn: object = large ? { paddingHorizontal: 22, paddingVertical: 17, minWidth: 64 } : {};

  return (
    <View style={styles.row}>
      <Btn onPress={prev} sound="click" style={bigBtn}>
        <Text style={[styles.icon, bigIcon]}>{"⏮"}</Text>
      </Btn>

      <Btn onPressIn={startRW} onPressOut={stopRW} sound="ff">
        <Text style={styles.icon}>{"⏪"}</Text>
      </Btn>

      <Btn
        green
        onPress={isPlaying ? pause : play}
        style={[styles.btnPlayLarge, bigPlayBtn]}
        sound={isPlaying ? "click" : "play"}
      >
        <Text style={[styles.iconPlay, bigIconPlay]}>{isPlaying ? "⏸" : "▶"}</Text>
      </Btn>

      <Btn onPress={stop} sound="stop">
        <Text style={styles.icon}>{"■"}</Text>
      </Btn>

      <Btn onPressIn={startFF} onPressOut={stopFF} sound="ff">
        <Text style={styles.icon}>{"⏩"}</Text>
      </Btn>

      <Btn onPress={next} sound="click" style={bigBtn}>
        <Text style={[styles.icon, bigIcon]}>{"⏭"}</Text>
      </Btn>
    </View>
  );
}

const BTN_BASE = {
  backgroundColor: "#2a2a36",
  borderColor: "#4a4a5a",
  borderWidth: 1.5,
  borderRadius: 6,
  paddingHorizontal: 8,
  paddingVertical: 8,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  minWidth: 36,
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  btn: BTN_BASE,
  btnPlay: {
    ...BTN_BASE,
    backgroundColor: "#149650",
    borderColor: "#1db060",
    borderRadius: 8,
  },
  btnPlayLarge: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  icon: {
    fontSize: 16,
    color: "#c8c8d2",
    lineHeight: 20,
  },
  iconPlay: {
    fontSize: 18,
    color: "white",
    lineHeight: 22,
  },
});
