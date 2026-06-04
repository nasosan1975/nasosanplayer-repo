import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  Animated,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Track, usePlayer } from "@/context/PlayerContext";
import { C } from "@/constants/colors";

const BROWSER_ROW_H = 63;

function MarqueeText({
  text,
  style,
  containerStyle,
  charWidth = 8,
}: {
  text: string;
  style?: object;
  containerStyle?: object;
  charWidth?: number;
}) {
  const [containerW, setContainerW] = useState(0);
  const textW = text.length * charWidth;
  const offsetAnim = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
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
    <View
      style={[{ overflow: "hidden" }, containerStyle]}
      onLayout={e => setContainerW(e.nativeEvent.layout.width)}
    >
      <Animated.Text
        style={[style, { transform: [{ translateX: Animated.multiply(offsetAnim, -1) }] }]}
      >
        {text}
      </Animated.Text>
    </View>
  );
}

function TrackRow({
  track,
  displayIndex,
  isActive,
  onPlay,
  onToggleFavorite,
  onEdit,
  digitCount,
}: {
  track: Track;
  displayIndex: number;
  isActive: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
  onEdit: () => void;
  digitCount: number;
}) {
  const num = String(displayIndex + 1).padStart(digitCount, "0");

  return (
    <TouchableOpacity
      style={[styles.row, isActive && styles.rowActive]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPlay();
      }}
      activeOpacity={0.7}
    >
      <Text style={[styles.num, isActive && styles.numActive]}>{num}</Text>
      <View style={styles.info}>
        <MarqueeText
          text={track.title || track.filename}
          style={[styles.title, isActive && styles.titleActive]}
          containerStyle={styles.titleScroll}
        />
        <MarqueeText
          text={track.artist || "\u00A0"}
          style={styles.artist}
          containerStyle={styles.titleScroll}
        />
      </View>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onEdit();
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.editIcon}>{"✎"}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggleFavorite();
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={[styles.star, track.favorite && styles.starActive]}>
          {track.favorite ? "★" : "☆"}
        </Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function BrowserScreen() {
  const {
    tracks,
    activeList,
    currentTrackId,
    seekToTrack,
    toggleFavorite,
    editTrackMeta,
    folderName,
    shuffleMode,
    favoritesMode,
    pauseForScreen,
    resumeAfterScreen,
  } = usePlayer();

  const [search, setSearch] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const currentTrackIdRef = useRef(currentTrackId);
  currentTrackIdRef.current = currentTrackId;

  const [editTarget, setEditTarget] = useState<Track | null>(null);
  const [editTitleVal, setEditTitleVal] = useState("");
  const [editArtistVal, setEditArtistVal] = useState("");

  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const botPad = isWeb ? 34 : insets.bottom;

  const baseList = (shuffleMode || favoritesMode) ? activeList : tracks;

  const filtered = useMemo(() => {
    if (!search.trim()) return baseList;
    const q = search.toLowerCase();
    return baseList.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.filename.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q)
    );
  }, [baseList, search]);

  const digitCount = filtered.length <= 9 ? 1 : filtered.length <= 99 ? 2 : 3;

  const modeLabel = shuffleMode
    ? "SHUFFLE"
    : favoritesMode
    ? "PREFERITI"
    : null;

  const currentIdxInFiltered = filtered.findIndex(t => t.id === currentTrackId);
  const safeInitialIndex = currentIdxInFiltered >= 0 ? currentIdxInFiltered : 0;

  // Pausa all'apertura, riprende alla chiusura — dipendenze stabili, non si riesegue al cambio lista
  useFocusEffect(
    useCallback(() => {
      pauseForScreen();
      return () => { resumeAfterScreen(); };
    }, [pauseForScreen, resumeAfterScreen])
  );

  // Scroll alla traccia corrente — separato per non riattivare pause/resume ad ogni ricerca
  useFocusEffect(
    useCallback(() => {
      const idx = filtered.findIndex(t => t.id === currentTrackIdRef.current);
      if (idx >= 0 && flatListRef.current) {
        const timer = setTimeout(() => {
          flatListRef.current?.scrollToOffset({
            offset: Math.max(0, (idx - 1) * BROWSER_ROW_H),
            animated: false,
          });
        }, 80);
        return () => clearTimeout(timer);
      }
    }, [filtered])
  );

  async function handlePlay(track: Track) {
    await seekToTrack(track.id);
    router.back();
  }

  function openEdit(track: Track) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditTarget(track);
    setEditTitleVal(track.title);
    setEditArtistVal(track.artist);
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
  }

  function handleEditCancel() {
    Keyboard.dismiss();
    setEditTarget(null);
  }

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backIcon}>{"‹"}</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {folderName || "Brani"}
          </Text>
          <Text style={styles.headerSub}>
            {filtered.length}/{tracks.length} tracce
            {modeLabel ? ` · ${modeLabel}` : ""}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchContainer}>
        <Text style={styles.searchIconText}>{"♪"}</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Cerca brani…"
          placeholderTextColor={C.borderInput}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.clearIcon}>{"✕"}</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        ref={flatListRef}
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            displayIndex={index}
            isActive={item.id === currentTrackId}
            onPlay={() => handlePlay(item)}
            onToggleFavorite={() => toggleFavorite(item.id)}
            onEdit={() => openEdit(item)}
            digitCount={digitCount}
          />
        )}
        contentContainerStyle={[styles.list, { paddingBottom: botPad + 16 }]}
        scrollEnabled
        keyboardShouldPersistTaps="handled"
        initialScrollIndex={safeInitialIndex}
        getItemLayout={(_, index) => ({
          length: BROWSER_ROW_H,
          offset: BROWSER_ROW_H * index,
          index,
        })}
        onScrollToIndexFailed={info => {
          flatListRef.current?.scrollToOffset({
            offset: BROWSER_ROW_H * info.index,
            animated: false,
          });
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{"♪"}</Text>
            <Text style={styles.emptyText}>Nessun brano trovato</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />

      <Modal
        visible={editTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={handleEditCancel}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={handleEditCancel}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>MODIFICA BRANO</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.separators,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: C.accent,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "300",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: "600",
  },
  headerSub: {
    color: C.borderInput,
    fontSize: 12,
    marginTop: 1,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    backgroundColor: C.panels,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.separators,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  searchIconText: {
    fontSize: 14,
    color: C.borderInput,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 15,
    padding: 0,
  },
  clearIcon: {
    color: C.borderInput,
    fontSize: 14,
    lineHeight: 18,
  },
  list: {
    paddingHorizontal: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: C.background,
    height: BROWSER_ROW_H - 1,
  },
  rowActive: {
    backgroundColor: C.rowActive,
    borderLeftWidth: 3,
    borderLeftColor: C.accent,
  },
  num: {
    color: C.borderInput,
    fontFamily: "monospace",
    fontSize: 12,
    minWidth: 28,
  },
  numActive: {
    color: C.accent,
  },
  info: {
    flex: 1,
    justifyContent: "center",
    gap: 1,
  },
  titleScroll: {
    flex: 1,
  },
  title: {
    color: C.text,
    fontSize: 14,
    lineHeight: 18,
  },
  titleActive: {
    color: C.accent,
  },
  artist: {
    color: C.notes,
    fontSize: 11,
    lineHeight: 14,
  },
  iconBtn: {
    padding: 4,
  },
  editIcon: {
    fontSize: 18,
    color: C.borderInput,
  },
  star: {
    fontSize: 20,
    color: C.borderInput,
  },
  starActive: {
    color: C.accent,
  },
  sep: {
    height: 1,
    backgroundColor: C.panels,
    marginLeft: 56,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    color: C.separators,
  },
  emptyText: {
    color: C.borderInput,
    fontSize: 15,
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
    gap: 8,
  },
  modalTitle: {
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
    marginTop: 8,
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
