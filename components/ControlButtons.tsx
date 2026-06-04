import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { usePlayer } from "@/context/PlayerContext";
import { initSounds, playSound, SoundName } from "@/utils/SoundManager";
import { C } from "@/constants/colors";

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

export default function ControlButtons({
  large = false,
  mainOnly = false,
  secondaryOnly = false,
  vertical = false,
}: {
  large?: boolean;
  mainOnly?: boolean;
  secondaryOnly?: boolean;
  vertical?: boolean;
}) {
  const { play, pause, stop, next, prev, startFF, stopFF, startRW, stopRW, isPlaying } = usePlayer();

  useEffect(() => {
    initSounds();
  }, []);

  const bigBtn: object = large ? { paddingHorizontal: 18, paddingVertical: 16, minWidth: 56 } : {};
  const bigIcon: object = large ? { fontSize: 28, lineHeight: 34 } : {};
  const bigIconPlay: object = large ? { fontSize: 32, lineHeight: 38 } : {};
  const bigPlayBtn: object = large ? { paddingHorizontal: 22, paddingVertical: 17, minWidth: 64 } : {};

  const prevBtn = (
    <Btn onPress={prev} sound="click" style={bigBtn}>
      <Text style={[styles.icon, bigIcon]}>{"⏮"}</Text>
    </Btn>
  );
  const rwBtn = (
    <Btn onPressIn={startRW} onPressOut={stopRW} sound="ff">
      <Text style={styles.icon}>{"⏪"}</Text>
    </Btn>
  );
  const playBtn = (
    <Btn green onPress={isPlaying ? pause : play} style={[styles.btnPlayLarge, bigPlayBtn]} sound={isPlaying ? "click" : "play"}>
      <Text style={[styles.iconPlay, bigIconPlay]}>{isPlaying ? "⏸" : "▶"}</Text>
    </Btn>
  );
  const stopBtn = (
    <Btn onPress={stop} sound="stop">
      <Text style={styles.icon}>{"■"}</Text>
    </Btn>
  );
  const ffBtn = (
    <Btn onPressIn={startFF} onPressOut={stopFF} sound="ff">
      <Text style={styles.icon}>{"⏩"}</Text>
    </Btn>
  );
  const nextBtn = (
    <Btn onPress={next} sound="click" style={bigBtn}>
      <Text style={[styles.icon, bigIcon]}>{"⏭"}</Text>
    </Btn>
  );

  if (mainOnly) {
    return (
      <View style={vertical ? styles.col : styles.row}>
        {prevBtn}{playBtn}{nextBtn}{vertical ? stopBtn : null}
      </View>
    );
  }
  if (secondaryOnly) {
    return (
      <View style={vertical ? styles.col : styles.row}>
        {rwBtn}{stopBtn}{ffBtn}
      </View>
    );
  }
  return (
    <View style={vertical ? styles.col : styles.row}>
      {prevBtn}{rwBtn}{playBtn}{stopBtn}{ffBtn}{nextBtn}
    </View>
  );
}

const BTN_BASE = {
  backgroundColor: C.panels,
  borderColor: C.borderInput,
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
  col: {
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  btn: BTN_BASE,
  btnPlay: {
    ...BTN_BASE,
    backgroundColor: C.playGreen,
    borderColor: C.playBorder,
    borderRadius: 8,
  },
  btnPlayLarge: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  icon: {
    fontSize: 16,
    color: C.text,
    lineHeight: 20,
  },
  iconPlay: {
    fontSize: 18,
    color: "white",
    lineHeight: 22,
  },
});
