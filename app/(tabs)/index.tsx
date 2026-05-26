import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import BottomRow from "@/components/BottomRow";
import CassetteSVG from "@/components/CassetteSVG";
import ControlButtons from "@/components/ControlButtons";
import TimeDisplay from "@/components/TimeDisplay";
import WalkmanEmpty from "@/components/WalkmanEmpty";
import { Track, usePlayer } from "@/context/PlayerContext";
import { useCarMode } from "@/utils/useCarMode";

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
    currentSide,
    sideProgress,
    toggleFavorite,
    stopCountdown,
    cancelStop,
    play,
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
    isWmaConverting,
    normalizeGains,
    isNormalizing,
    normalizationActive,
    normalizingProgress,
    clearNormalization,
    resetNormalization,
  } = usePlayer();

  const [editTarget, setEditTarget] = useState<Track | null>(null);
  const [editTitleVal, setEditTitleVal] = useState("");
  const [editArtistVal, setEditArtistVal] = useState("");

  const isCarMode = useCarMode();

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
              placeholderTextColor="#4a4a5a"
              placeholder="Titolo…"
            />
            <Text style={styles.modalFieldLabel}>Artista</Text>
            <TextInput
              style={styles.modalInput}
              value={editArtistVal}
              onChangeText={setEditArtistVal}
              returnKeyType="done"
              onSubmitEditing={handleEditSave}
              placeholderTextColor="#4a4a5a"
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
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleFavorites(); }}
      activeOpacity={0.7}
    >
      <Text style={[styles.secBtnIcon, favoritesMode && styles.secBtnIconActive]}>
        {favoritesMode ? "★" : "☆"}
      </Text>
      <Text style={[styles.secBtnLabel, favoritesMode && styles.secBtnLabelActive]}>FAV</Text>
    </TouchableOpacity>
  );

  const normBtn = (
    <TouchableOpacity
      style={[
        styles.secBtn,
        !normalizationActive && !isNormalizing && styles.normBtnOff,
        normalizationActive && styles.normBtnActive,
        isNormalizing && styles.normBtnAnalyzing,
      ]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (isNormalizing) return;
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
        normalizationActive && styles.normBtnIconActive,
        isNormalizing && { color: "#ffb432" },
        !normalizationActive && !isNormalizing && { color: "#e05555" },
      ]}>
        {isNormalizing && normalizingProgress
          ? String(normalizingProgress.current).padStart(2, "0")
          : "N"}
      </Text>
      <Text style={[
        styles.secBtnLabel,
        normalizationActive && styles.normBtnLabelActive,
        isNormalizing && { color: "#ffb432" },
        !normalizationActive && !isNormalizing && { color: "#e05555" },
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

  // Riga unica controlli — SOLO car mode (con counter, full width)
  const lsControlsRow = (
    <View style={[styles.landscapeSingleRow, { paddingBottom: botPad }]}>
      {controlsContent}
      <View style={styles.counterBox}>
        <Text style={styles.counterText}>
          {showNoFavoritesMsg ? "no fav" : formatCounter(currentIndexInActive, activeList.length)}
        </Text>
      </View>
    </View>
  );

  /* ── CAR MODE (cavo USB) — cassetta centrata, niente lista, una riga ──── */
  if (isCarMode) {
    return (
      <View style={[styles.carModeRoot, { paddingTop: topPad }]}>
        {/* Cassetta centrata */}
        <View style={styles.lsCassetteArea}>
          {cassetteNode}
        </View>
        {/* Riga controlli car mode — prev/play/next grandi */}
        <View style={[styles.landscapeSingleRow, { paddingBottom: botPad }]}>
          <ControlButtons large />
          {normBtn}
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
          <TouchableOpacity
            style={[styles.secBtn, favoritesMode && styles.secBtnActive]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleFavorites(); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.secBtnIcon, favoritesMode && styles.secBtnIconActive]}>
              {favoritesMode ? "★" : "☆"}
            </Text>
            <Text style={[styles.secBtnLabel, favoritesMode && styles.secBtnLabelActive]}>FAV</Text>
          </TouchableOpacity>
          {settingsBtn}
          <TimeDisplay compact />
          <View style={styles.counterBox}>
            <Text style={styles.counterText}>
              {showNoFavoritesMsg
                ? "no fav"
                : isWmaConverting
                ? "elab..."
                : formatCounter(currentIndexInActive, activeList.length)}
            </Text>
          </View>
        </View>
        {editModal}
      </View>
    );
  }

  /* ── LANDSCAPE NATURALE (senza cavo) — cassetta sx + lista dx ──────────── */
  if (isNaturalLandscape) {
    return (
      <View style={[styles.carModeRoot, { paddingTop: topPad }]}>
        {/* Riga superiore: cassetta sinistra + divisore + logo/lista destra */}
        <View style={styles.lsBodyRow}>
          <View style={styles.lsCassetteArea}>
            {cassetteNode}
          </View>
          <View style={styles.lsDivider} />
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
                  : isWmaConverting
                  ? "elaborazione..."
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
        </View>
        {/* Riga controlli centrata sotto la cassetta */}
        <View style={[styles.lsBottomRow, { paddingBottom: botPad }]}>
          <View style={styles.lsControlsUnderCassette}>
            {controlsContent}
          </View>
          <View style={styles.lsDivider} />
          <View style={styles.lsControlsUnderRight} />
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
      {isWmaConverting && (
        <Text style={styles.wmaHint}>elaborazione in corso...</Text>
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
    backgroundColor: "#1e1e26",
    alignItems: "center",
    justifyContent: "space-between",
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
    color: "#4a4a5a",
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  wmaHint: {
    color: "#ffb432",
    fontSize: 11,
    textAlign: "center" as const,
    letterSpacing: 0.8,
    fontFamily: "monospace" as const,
    marginBottom: 6,
  },

  carModeRoot: {
    flex: 1,
    backgroundColor: "#1e1e26",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  lsBodyRow: {
    flex: 1,
    flexDirection: "row",
    width: "100%",
  },
  landscapeRoot: {
    flex: 1,
    backgroundColor: "#1e1e26",
    flexDirection: "row",
  },
  lsLeft: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  lsCassetteArea: {
    flex: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  logoTopRight: {
    position: "absolute",
    right: 8,
    top: "50%" as unknown as number,
    marginTop: -19,
    zIndex: 2,
  },
  logoLandscape: {
    width: 108,
    height: 38,
  },
  landscapeSingleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 4,
    flexWrap: "nowrap",
    width: "100%",
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  lsDivider: {
    width: 1,
    backgroundColor: "#3a3a4a",
    marginVertical: 8,
  },
  lsRight: {
    flex: 4,
    backgroundColor: "#1e1e26",
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
    backgroundColor: "#16161e",
    borderBottomWidth: 1,
    borderBottomColor: "#3a3a4a",
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
  },
  lsListContent: {
    paddingVertical: 4,
    flexGrow: 1,
  },
  lsBottomRow: {
    flexDirection: "row",
    width: "100%",
    alignItems: "center",
    paddingTop: 4,
  },
  lsControlsUnderCassette: {
    flex: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 4,
    flexWrap: "nowrap",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  lsControlsUnderRight: {
    flex: 4,
  },
  lsTrackRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    height: 40,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a36",
  },
  lsTrackRowActive: {
    backgroundColor: "#2a2a36",
  },
  lsTrackNum: {
    color: "#4a4a5a",
    fontFamily: "monospace" as const,
    fontSize: 10,
    lineHeight: 14,
    minWidth: 18,
    textAlign: "right",
  },
  lsTrackNumActive: {
    color: "#64c8ff",
  },
  lsTrackInfo: {
    flex: 1,
    gap: 1,
  },
  lsTrackTitle: {
    color: "#c8c8d2",
    fontSize: 12,
    lineHeight: 15,
  },
  lsTrackTitleActive: {
    color: "#64c8ff",
    fontWeight: "600" as const,
  },
  lsTrackArtist: {
    color: "#6a7a8a",
    fontSize: 10,
    lineHeight: 13,
  },
  lsTrackStar: {
    color: "#c8c8d2",
    fontSize: 10,
    lineHeight: 14,
  },
  lsBottomBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    width: "100%",
    paddingTop: 4,
  },
  secBtn: {
    backgroundColor: "#2a2a36",
    borderColor: "#4a4a5a",
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: "center",
    minWidth: 36,
  },
  secBtnActive: { borderColor: "#64c8ff" },
  normBtnOff: { borderColor: "#962828", backgroundColor: "#2a1010" },
  normBtnActive: { borderColor: "#64c864", backgroundColor: "#102010" },
  normBtnAnalyzing: { borderColor: "#ffb432", backgroundColor: "#2a2010" },
  normBtnIconActive: { color: "#64c864" },
  normBtnLabelActive: { color: "#64c864" },
  secBtnIcon: { fontSize: 16, color: "#c8c8d2", lineHeight: 20 },
  secBtnIconActive: { color: "#64c8ff" },
  secBtnLabel: {
    color: "#8cc8ff",
    fontSize: 7,
    marginTop: 1,
    fontFamily: "monospace" as const,
  },
  secBtnLabelActive: { color: "#64c8ff" },

  counterBox: {
    flex: 1,
    backgroundColor: "#16161e",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3a3a4a",
    paddingHorizontal: 6,
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: "#64c8ff",
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
    backgroundColor: "#2a2a36",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3a3a4a",
    padding: 20,
    width: 300,
    gap: 12,
  },
  modalLabel: {
    color: "#64c8ff",
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "600",
    marginBottom: 4,
  },
  modalFieldLabel: {
    color: "#8cc8ff",
    fontSize: 11,
    letterSpacing: 0.8,
    marginTop: 4,
  },
  modalInput: {
    backgroundColor: "#16161e",
    borderWidth: 1,
    borderColor: "#64c8ff",
    borderRadius: 6,
    color: "#c8c8d2",
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
    borderColor: "#3a3a4a",
  },
  modalBtnCancelText: { color: "#8cc8ff", fontSize: 14 },
  modalBtnSave: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: "#149650",
    borderWidth: 1,
    borderColor: "#1db060",
  },
  modalBtnSaveText: { color: "white", fontSize: 14, fontWeight: "600" },
});
