import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  DeviceEventEmitter,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  requireNativeComponent,
  useWindowDimensions,
} from "react-native";

import BottomRow from "@/components/BottomRow";
import CassetteSVG from "@/components/CassetteSVG";
import ControlButtons from "@/components/ControlButtons";
import TimeDisplay from "@/components/TimeDisplay";
import WalkmanEmpty from "@/components/WalkmanEmpty";
import { Track, usePlayer } from "@/context/PlayerContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { C } from "@/constants/colors";

const SpeechnotesWidgetView = requireNativeComponent<{ onWidgetTap?: (e: any) => void; onWidgetError?: (e: any) => void; style?: any }>("SpeechnotesWidgetView");
const CarModeModule = NativeModules.CarModeModule as {
  isInCarMode(): Promise<boolean>;
  startListening(): void;
} | undefined;


const LOGO_FULL = require("../../assets/images/nasosan_logo_full.png");

function MarqueeText({ text, style, containerStyle, charWidth = 7 }: { text: string; style?: object; containerStyle?: object; charWidth?: number }) {
  const [containerW, setContainerW] = useState(0);
  const textW = text.length * charWidth;
  const offsetAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (animRef.current) { animRef.current.stop(); animRef.current = null; }
    offsetAnim.setValue(0);
    if (containerW > 0 && textW > containerW) {
      const dist = textW - containerW + 16;
      animRef.current = Animated.loop(
        Animated.sequence([
          Animated.delay(1000),
          Animated.timing(offsetAnim, { toValue: dist, duration: dist * 22, useNativeDriver: true }),
          Animated.delay(600),
          Animated.timing(offsetAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
      animRef.current.start();
    }
    return () => { animRef.current?.stop(); };
  }, [containerW, textW, text, offsetAnim]);
  return (
    <View style={[{ overflow: "hidden" }, containerStyle]} onLayout={e => setContainerW(e.nativeEvent.layout.width)}>
      <Animated.Text
        style={[style, { transform: [{ translateX: Animated.multiply(offsetAnim, -1) }] }]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}


function formatCounter(current: number, total: number): string {
  if (total <= 0) return "0/0";
  const digits = total <= 9 ? 1 : total <= 99 ? 2 : total <= 999 ? 3 : 4;
  const cur = String(current + 1).padStart(digits, "0");
  const tot = String(total).padStart(digits, "0");
  return `${cur}/${tot}`;
}

export default function PlayerScreen() {
  const {
    folderUri,
    folderName,
    currentTrack,
    currentTrackId,
    isPlaying,
    isPaused,
    currentSide,
    sideProgress,
    toggleFavorite,
    stopCountdown,
    cancelStop,
    play,
    pause,
    stop,
    activeList,
    currentIndexInActive,
    seekToTrack,
    editTrackMeta,
    isFF,
    isRW,
    shuffleMode,
    favoritesMode,
    toggleShuffle,
    regenerateShuffle,
    toggleFavorites,
    showNoFavoritesMsg,
    pauseForScreen,
    resumeAfterScreen,
    normalizeGains,
    isNormalizing,
    normalizationActive,
    normalizationPending,
    normalizingProgress,
    clearNormalization,
    resetNormalization,
    cancelNormalization,
  } = usePlayer();


  const [editTarget, setEditTarget] = useState<Track | null>(null);
  const [editTitleVal, setEditTitleVal] = useState("");
  const [editArtistVal, setEditArtistVal] = useState("");
  const [speechnoteEnabled, setSpeechnoteEnabled] = useState(false);
  const [isCarMode, setIsCarMode] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      AsyncStorage.getItem("speechnote_enabled").then(v => setSpeechnoteEnabled(v === "true")).catch(() => {});
    }, [])
  );

  useEffect(() => {
    if (!CarModeModule) return;
    CarModeModule.isInCarMode().then(v => setIsCarMode(v)).catch(() => {});
    CarModeModule.startListening();
    const enterSub = DeviceEventEmitter.addListener("nasosan_car_enter", () => setIsCarMode(true));
    const exitSub = DeviceEventEmitter.addListener("nasosan_car_exit", () => {
      setIsCarMode(false);
      pause();
    });
    return () => {
      enterSub.remove();
      exitSub.remove();
    };
  }, []);

  function handleWidgetTap() {
    if (isPlaying) pause();
  }

  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isNaturalLandscape = width > height;
  const isWeb = Platform.OS === "web";

  const LS_ROW_H = 40;
  const flatListRef = useRef<FlatList>(null);
  useEffect(() => {
    if (!isNaturalLandscape) return;
    const idx = activeList.findIndex(t => t.id === currentTrackId);
    if (idx >= 0 && flatListRef.current) {
      flatListRef.current.scrollToOffset({
        offset: Math.max(0, (idx - 1) * LS_ROW_H),
        animated: false,
      });
    }
  }, [currentTrackId, isNaturalLandscape, activeList]);
  const topPad = isWeb ? 67 : insets.top;
  const botPad = isWeb ? 34 : insets.bottom;

  const hasCassette = !!folderUri && currentTrack !== null;

  function handleCassetteTap() {
    if (stopCountdown !== null) {
      cancelStop();
      play();
      return;
    }
    if (!folderUri) {
      router.push("/settings");
    } else {
      router.push("/browser");
    }
  }

  function handleStarTap() {
    if (currentTrack) toggleFavorite(currentTrack.id);
  }

  function handleBadgeTap() {
    if (activeList.length === 0) return;
    const sideACount = Math.ceil(activeList.length / 2);
    const mirrorIdx = Math.max(0, Math.min(activeList.length - 1, 2 * sideACount - 1 - currentIndexInActive));
    const mirrorTrack = activeList[mirrorIdx];
    if (mirrorTrack) seekToTrack(mirrorTrack.id, isPlaying);
  }

  function openEdit(track: Track) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pauseForScreen();
    setEditTarget(track);
    setEditTitleVal(track.title);
    setEditArtistVal(track.artist);
  }

  function handleTitleTap() {
    if (!currentTrack) return;
    openEdit(currentTrack);
  }

  function handleArtistTap() {
    if (!currentTrack) return;
    openEdit(currentTrack);
  }

  async function handleEditSave() {
    if (!editTarget) return;
    Keyboard.dismiss();
    await editTrackMeta(
      editTarget.id,
      editTitleVal.trim() || editTarget.title,
      editArtistVal.trim() || editTarget.artist
    );
    setEditTarget(null);
    resumeAfterScreen();
  }

  function handleEditCancel() {
    Keyboard.dismiss();
    setEditTarget(null);
    resumeAfterScreen();
  }

  const cassetteNode = hasCassette ? (
    <CassetteSVG
      folderName={folderName}
      trackTitle={currentTrack?.title ?? ""}
      trackArtist={currentTrack?.artist ?? ""}
      side={currentSide}
      sideProgress={sideProgress}
      isPlaying={isPlaying}
      isFavorite={currentTrack?.favorite ?? false}
      isFF={isFF}
      isRW={isRW}
      stopCountdown={stopCountdown}
      onTap={handleCassetteTap}
      onStarTap={handleStarTap}
      onBadgeTap={handleBadgeTap}
      onTitleTap={handleTitleTap}
      onArtistTap={handleArtistTap}
    />
  ) : (
    <WalkmanEmpty onTap={handleCassetteTap} />
  );

  const editModal = (
    <Modal
      visible={editTarget !== null}
      transparent
      animationType="fade"
      onRequestClose={handleEditCancel}
    >
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={handleEditCancel}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={styles.modalCard}>
            <Text style={styles.modalLabel}>MODIFICA BRANO</Text>
            <Text style={styles.modalFieldLabel}>Titolo</Text>
            <TextInput
              style={styles.modalInput}
              value={editTitleVal}
              onChangeText={setEditTitleVal}
              autoFocus
              returnKeyType="next"
              blurOnSubmit={false}
              placeholderTextColor={C.borderInput}
              placeholder="Titolo…"
            />
            <Text style={styles.modalFieldLabel}>Artista</Text>
            <TextInput
              style={styles.modalInput}
              value={editArtistVal}
              onChangeText={setEditArtistVal}
              returnKeyType="done"
              onSubmitEditing={handleEditSave}
              placeholderTextColor={C.borderInput}
              placeholder="Artista…"
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalBtnCancel} onPress={handleEditCancel} activeOpacity={0.8}>
                <Text style={styles.modalBtnCancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBtnSave} onPress={handleEditSave} activeOpacity={0.8}>
                <Text style={styles.modalBtnSaveText}>Salva</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );


  const settingsBtn = (
    <TouchableOpacity
      style={styles.secBtn}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/settings"); }}
      activeOpacity={0.7}
    >
      <Text style={styles.secBtnIcon}>{"⚙"}</Text>
      <Text style={styles.secBtnLabel}>IMP</Text>
    </TouchableOpacity>
  );

  const shuffleBtn = (
    <TouchableOpacity
      style={[styles.secBtn, shuffleMode && styles.secBtnActive]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleShuffle(); }}
      onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); regenerateShuffle(); }}
      delayLongPress={3000}
      activeOpacity={0.7}
    >
      <Text style={[styles.secBtnIcon, shuffleMode && styles.secBtnIconActive]}>{"⇄"}</Text>
      <Text style={[styles.secBtnLabel, shuffleMode && styles.secBtnLabelActive]}>SHUF</Text>
    </TouchableOpacity>
  );

  const favBtn = (
    <TouchableOpacity
      style={[styles.secBtn, favoritesMode && styles.secBtnActive]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (currentTrack) toggleFavorite(currentTrack.id);
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        toggleFavorites();
      }}
      delayLongPress={3000}
      activeOpacity={0.7}
    >
      <Text style={[styles.secBtnIcon, currentTrack?.favorite && styles.secBtnIconActive]}>
        {currentTrack?.favorite ? "★" : "☆"}
      </Text>
      <Text style={[styles.secBtnLabel, favoritesMode && styles.secBtnLabelActive]}>FAV</Text>
    </TouchableOpacity>
  );

  const normBtn = (
    <TouchableOpacity
      style={[
        styles.secBtn,
        !normalizationActive && !isNormalizing && !normalizationPending && styles.normBtnOff,
        normalizationActive && !normalizationPending && styles.normBtnActive,
        (isNormalizing || normalizationPending) && styles.normBtnAnalyzing,
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (isNormalizing) { cancelNormalization(); return; }
        if (normalizationPending) { normalizeGains(); return; }
        if (normalizationActive) clearNormalization();
        else normalizeGains();
      }}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        resetNormalization();
      }}
      delayLongPress={3000}
      activeOpacity={0.7}
    >
      <Text style={[
        styles.secBtnIcon,
        normalizationActive && !normalizationPending && styles.normBtnIconActive,
        (isNormalizing || normalizationPending) && { color: C.warning },
        !normalizationActive && !isNormalizing && !normalizationPending && { color: C.error },
      ]}>
        {isNormalizing && normalizingProgress
          ? String(normalizingProgress?.current ?? 0).padStart(2, "0")
          : "N"}
      </Text>
      <Text style={[
        styles.secBtnLabel,
        normalizationActive && !normalizationPending && styles.normBtnLabelActive,
        (isNormalizing || normalizationPending) && { color: C.warning },
        !normalizationActive && !isNormalizing && !normalizationPending && { color: C.error },
      ]}>
        {"NORM"}
      </Text>
    </TouchableOpacity>
  );

  // Contenuto pulsanti riusato in car mode e landscape
  const controlsContent = (
    <>
      <ControlButtons />
      {normBtn}
      {shuffleBtn}
      {favBtn}
      {settingsBtn}
      <TimeDisplay compact />
    </>
  );

  /* ── LANDSCAPE NATURALE — cassetta + lista, controlli in basso ── */
  if (isNaturalLandscape) {
    return (
      <View style={[styles.lsRoot, { paddingTop: topPad, paddingBottom: botPad }]}>
        {/* SINISTRA: cassetta + controlli */}
        <View style={styles.lsLeft}>
          <View style={styles.lsCassetteArea}>
            {cassetteNode}
          </View>
          <View style={styles.lsControlsRow}>
            {controlsContent}
          </View>
        </View>
        <View style={styles.lsDivider} />
        {/* DESTRA: lista piena altezza */}
        <View style={styles.lsRight}>
          <TouchableOpacity
            style={styles.lsLogoWrapper}
            onPress={() => Linking.openURL("https://www.nasosan.it")}
            activeOpacity={0.7}
          >
            <Image source={LOGO_FULL} style={styles.lsLogo} resizeMode="contain" />
          </TouchableOpacity>
          <View style={styles.lsCounterRow}>
            <Text style={styles.counterText}>
              {showNoFavoritesMsg
                ? "no fav"
                : formatCounter(currentIndexInActive, activeList.length)}
            </Text>
          </View>
          <FlatList
            ref={flatListRef}
            data={activeList}
            keyExtractor={(item) => String(item.id)}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={styles.lsListContent}
            getItemLayout={(_data, index) => ({
              length: LS_ROW_H,
              offset: LS_ROW_H * index,
              index,
            })}
            renderItem={({ item, index }) => {
              const isActive = item.id === currentTrackId;
              return (
                <TouchableOpacity
                  style={[styles.lsTrackRow, isActive && styles.lsTrackRowActive]}
                  onPress={() => seekToTrack(item.id, isPlaying)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.lsTrackNum, isActive && styles.lsTrackNumActive]}>
                    {String(index + 1).padStart(2, "0")}
                  </Text>
                  <View style={styles.lsTrackInfo}>
                    <MarqueeText
                      text={item.title}
                      style={[styles.lsTrackTitle, isActive && styles.lsTrackTitleActive]}
                      containerStyle={{ flex: 1 }}
                    />
                    {item.artist ? (
                      <Text style={styles.lsTrackArtist} numberOfLines={1}>
                        {item.artist}
                      </Text>
                    ) : null}
                  </View>
                  {item.favorite && (
                    <Text style={styles.lsTrackStar}>{"★"}</Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
        {editModal}
      </View>
    );
  }

  /* ── PORTRAIT ─────────────────────────────────────────────────────────── */
  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad }]}>

      <View style={styles.cassetteWrapper}>
        <TouchableOpacity
          style={styles.logoPortraitWrapper}
          onPress={() => Linking.openURL("https://www.nasosan.it")}
          activeOpacity={0.7}
        >
          <Image source={LOGO_FULL} style={styles.logoPortrait} resizeMode="contain" />
        </TouchableOpacity>
        {cassetteNode}
      </View>

      {!folderUri && (
        <Text style={styles.hint}>Tocca il player per selezionare una cassetta</Text>
      )}

      {speechnoteEnabled && isCarMode && (
        <View style={styles.speechnoteArea}>
          <View style={{ flex: 1 }} />
          {widgetError ? (
            <View style={[styles.speechnoteWidget, { justifyContent: "center", alignItems: "center" }]}>
              <Text style={{ color: C.warning, fontSize: 12, textAlign: "center", paddingHorizontal: 8 }}>
                {widgetError}
              </Text>
            </View>
          ) : (
            <SpeechnotesWidgetView
              style={styles.speechnoteWidget}
              onWidgetTap={handleWidgetTap}
              onWidgetError={(e: any) => setWidgetError(e?.nativeEvent?.error ?? "Errore widget")}
            />
          )}
          <View style={{ flex: 1 }} />
        </View>
      )}

      <View style={styles.controlsArea}>
        <View style={styles.portraitControlsRow}>
          <ControlButtons />
          {normBtn}
        </View>
        <View style={{ height: 8 }} />
        <BottomRow />
      </View>
      {editModal}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: "center",
    justifyContent: "space-between",
  },
  speechnoteArea: {
    flex: 1,
    width: "100%",
    flexDirection: "column",
  },
  speechnoteWidget: {
    flex: 8,
    width: "100%",
  },
  cassetteWrapper: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    gap: 6,
  },
  logoPortraitWrapper: {
    width: "100%",
    alignItems: "center",
  },
  logoPortrait: {
    width: 280,
    height: 56,
  },
  controlsArea: {
    width: "100%",
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  portraitControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  hint: {
    color: C.borderInput,
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 8,
  },

  lsRoot: {
    flex: 1,
    backgroundColor: C.background,
    flexDirection: "row",
    paddingHorizontal: 8,
  },
  lsLeft: {
    flex: 6,
    flexDirection: "column",
    justifyContent: "space-between",
  },
  lsCassetteArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
  },
  lsControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 4,
    flexWrap: "nowrap",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  lsDivider: {
    width: 1,
    backgroundColor: C.separators,
    marginVertical: 8,
  },
  lsRight: {
    flex: 4,
    backgroundColor: C.background,
    flexDirection: "column",
    overflow: "hidden",
  },
  lsLogoWrapper: {
    width: "100%",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 6,
  },
  lsLogo: {
    width: 160,
    height: 32,
  },
  lsCounterRow: {
    backgroundColor: C.dark,
    borderBottomWidth: 1,
    borderBottomColor: C.separators,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
  },
  lsListContent: {
    paddingVertical: 4,
    flexGrow: 1,
  },
  lsTrackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 40,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.panels,
  },
  lsTrackRowActive: {
    backgroundColor: C.panels,
  },
  lsTrackNum: {
    color: C.borderInput,
    fontFamily: "monospace" as const,
    fontSize: 10,
    lineHeight: 14,
    minWidth: 18,
    textAlign: "right",
  },
  lsTrackNumActive: {
    color: C.accent,
  },
  lsTrackInfo: {
    flex: 1,
    gap: 1,
  },
  lsTrackTitle: {
    color: C.text,
    fontSize: 12,
    lineHeight: 15,
  },
  lsTrackTitleActive: {
    color: C.accent,
    fontWeight: "600" as const,
  },
  lsTrackArtist: {
    color: "#6a7a8a",
    fontSize: 10,
    lineHeight: 13,
  },
  lsTrackStar: {
    color: C.text,
    fontSize: 10,
    lineHeight: 14,
  },
  secBtn: {
    backgroundColor: C.panels,
    borderColor: C.borderInput,
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: "center",
    minWidth: 36,
  },
  secBtnActive: { borderColor: C.accent },
  normBtnOff: { borderColor: C.normOffBorder, backgroundColor: C.errorBg },
  normBtnActive: { borderColor: C.ok, backgroundColor: C.normActiveBg },
  normBtnAnalyzing: { borderColor: C.warning, backgroundColor: C.normAnalyzingBg },
  normBtnIconActive: { color: C.ok },
  normBtnLabelActive: { color: C.ok },
  secBtnIcon: { fontSize: 16, color: C.text, lineHeight: 20 },
  secBtnIconActive: { color: C.accent },
  secBtnLabel: {
    color: C.notes,
    fontSize: 7,
    marginTop: 1,
    fontFamily: "monospace" as const,
  },
  secBtnLabelActive: { color: C.accent },

  counterBox: {
    flex: 1,
    backgroundColor: C.dark,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.separators,
    paddingHorizontal: 6,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: C.accent,
    fontFamily: "monospace" as const,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: C.panels,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.separators,
    padding: 20,
    width: 300,
    gap: 12,
  },
  modalLabel: {
    color: C.accent,
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "600",
    marginBottom: 4,
  },
  modalFieldLabel: {
    color: C.notes,
    fontSize: 11,
    letterSpacing: 0.8,
    marginTop: 4,
  },
  modalInput: {
    backgroundColor: C.dark,
    borderWidth: 1,
    borderColor: C.accent,
    borderRadius: 6,
    color: C.text,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  modalBtnCancel: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.separators,
  },
  modalBtnCancelText: { color: C.notes, fontSize: 14 },
  modalBtnSave: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: C.playGreen,
    borderWidth: 1,
    borderColor: C.playBorder,
  },
  modalBtnSaveText: { color: "white", fontSize: 14, fontWeight: "600" },

});
