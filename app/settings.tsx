import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import {
  Alert,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { usePlayer } from "@/context/PlayerContext";
import { C } from "@/constants/colors";

const SpeechnotesModule = NativeModules.SpeechnotesWidgetModule as {
  isInstalled(): Promise<boolean>;
  openPlayStore(): void;
  requestBind(): Promise<number>;
  unbind(): void;
  getWidgetId(): Promise<number>;
} | undefined;

function LedIndicator({ active }: { active: boolean }) {
  return (
    <View style={[styles.led, active ? styles.ledGreen : styles.ledRed]} />
  );
}

export default function SettingsScreen() {
  const {
    folderUri,
    folderName,
    tracks,
    pickFolder,
    clearFolder,
    resetCassetteData,
    pauseForScreen,
    resumeAfterScreen,
  } = usePlayer();

  useFocusEffect(
    React.useCallback(() => {
      pauseForScreen();
      return () => { resumeAfterScreen(); };
    }, [pauseForScreen, resumeAfterScreen])
  );

  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [speechnoteState, setSpeechnoteState] = React.useState<"off" | "yellow" | "green">("off");
  const [speechnoteMsg, setSpeechnoteMsg] = React.useState<string | null>(null);
  const [speechnoteLoading, setSpeechnoteLoading] = React.useState(false);

  React.useEffect(() => {
    async function checkSpeechnote() {
      if (!SpeechnotesModule) return;
      const saved = await AsyncStorage.getItem("speechnote_enabled").catch(() => null);
      if (saved !== "true") { setSpeechnoteState("off"); return; }
      const installed = await SpeechnotesModule.isInstalled().catch(() => false);
      if (!installed) { setSpeechnoteState("yellow"); return; }
      const wid = await SpeechnotesModule.getWidgetId().catch(() => -1);
      if (wid >= 0) {
        setSpeechnoteState("green");
      } else {
        setSpeechnoteState("yellow");
        setSpeechnoteMsg("Widget non abbinato, tocca per annullare");
      }
    }
    checkSpeechnote();
  }, []);

  async function handleSpeechnoteToggle() {
    if (!SpeechnotesModule || speechnoteLoading) return;
    setSpeechnoteLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (speechnoteState === "green") {
        SpeechnotesModule.unbind();
        await AsyncStorage.setItem("speechnote_enabled", "false").catch(() => {});
        setSpeechnoteState("off");
        setSpeechnoteMsg(null);
      } else if (speechnoteState === "yellow") {
        await AsyncStorage.setItem("speechnote_enabled", "false").catch(() => {});
        setSpeechnoteState("off");
        setSpeechnoteMsg(null);
      } else {
        setSpeechnoteMsg(null);
        const installed = await SpeechnotesModule.isInstalled().catch(() => false);
        if (!installed) {
          await AsyncStorage.setItem("speechnote_enabled", "true").catch(() => {});
          setSpeechnoteState("yellow");
          return;
        }
        try {
          const wid = await SpeechnotesModule.requestBind();
          if (wid >= 0) {
            await AsyncStorage.setItem("speechnote_enabled", "true").catch(() => {});
            setSpeechnoteState("green");
          }
        } catch (e: any) {
          setSpeechnoteState("yellow");
          setSpeechnoteMsg(
            e?.code === "NO_PROVIDER" ? "Widget non trovato in Speechnotes" :
            e?.code === "DENIED" ? "Permesso negato, riprova" :
            "Errore durante l'attivazione"
          );
        }
      }
    } finally {
      setSpeechnoteLoading(false);
    }
  }

  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? 67 : insets.top;
  const botPad = isWeb ? 34 : insets.bottom;

  async function handlePickFolder() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsLoading(true);
    setError(null);
    try {
      await pickFolder();
    } catch {
      setError("Impossibile aprire la cartella");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClearFolder() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    clearFolder();
  }

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad + 12 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backIcon}>{"‹"}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Impostazioni</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* CASSETTA */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CASSETTA</Text>
          <View style={styles.card}>
            <View style={styles.folderRow}>
              <LedIndicator active={!!folderUri} />
              <View style={styles.folderInfo}>
                <Text style={styles.folderName} numberOfLines={1}>
                  {folderName && folderUri ? folderName : "Nessuna cassetta inserita"}
                </Text>
                {folderUri ? (
                  <Text style={styles.folderSub}>
                    {tracks.length} {tracks.length === 1 ? "traccia" : "tracce"} trovate
                  </Text>
                ) : (
                  <Text style={styles.folderSub}>
                    Seleziona una cartella con file audio
                  </Text>
                )}
              </View>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handlePickFolder}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <Text style={styles.primaryBtnText}>Caricamento…</Text>
          ) : (
            <>
              <Text style={styles.primaryBtnIcon}>{"📂"}</Text>
              <Text style={styles.primaryBtnText}>
                {folderUri ? "Cambia cassetta" : "Inserisci cassetta"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorIcon}>{"⚠"}</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* RIMUOVI CASSETTA */}
        {folderUri ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RIMUOVI CASSETTA</Text>
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={handleClearFolder}
              activeOpacity={0.8}
            >
              <Text style={styles.dangerIcon}>{"⏏"}</Text>
              <Text style={styles.dangerBtnText}>Espelli cassetta</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* RESET CASSETTA */}
        {folderUri ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RESET CASSETTA</Text>
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={() => {
                Alert.alert(
                  "Reset cassetta",
                  "Cancella il file dati della cassetta corrente.\nSaranno persi: posizioni, modifiche titoli/artisti, normalizzazione, preferiti.",
                  [
                    { text: "Annulla", style: "cancel" },
                    {
                      text: "Reset",
                      style: "destructive",
                      onPress: () => { resetCassetteData().catch(() => {}); },
                    },
                  ]
                );
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dangerIcon}>{"🗑"}</Text>
              <Text style={styles.dangerBtnText}>Reset dati cassetta</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* SPEECHNOTES WIDGET */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>WIDGET SPEECHNOTES</Text>
          <View style={styles.card}>
            <View style={styles.folderRow}>
              <View style={[styles.led,
                speechnoteState === "green" ? styles.ledGreen :
                speechnoteState === "yellow" ? styles.ledYellow : styles.ledRed
              ]} />
              <View style={styles.folderInfo}>
                <Text style={styles.folderName}>
                  {speechnoteState === "green" ? "Widget attivo" :
                   speechnoteState === "yellow" && speechnoteMsg ? "Widget non disponibile" :
                   speechnoteState === "yellow" ? "Speechnotes non installata" :
                   "Widget disabilitato"}
                </Text>
                <Text style={styles.folderSub}>
                  {speechnoteState === "green" ? "Visibile tra cassetta e controlli" :
                   speechnoteState === "yellow" ? "Tocca per annullare" :
                   "Abilita per usare Speechnotes nel player"}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.speechnoteBtn,
                  speechnoteState === "green" ? styles.speechnoteBtnGreen :
                  speechnoteState === "yellow" ? styles.speechnoteBtnYellow : styles.speechnoteBtnRed
                ]}
                onPress={handleSpeechnoteToggle}
                disabled={speechnoteLoading}
                activeOpacity={0.7}
              >
                <Text style={styles.speechnoteBtnText}>
                  {speechnoteState === "green" ? "ON" : speechnoteState === "yellow" ? "!" : "OFF"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {speechnoteState === "yellow" && SpeechnotesModule ? (
          speechnoteMsg ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorIcon}>{"⚠"}</Text>
              <Text style={styles.errorText}>{speechnoteMsg}</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.installBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); SpeechnotesModule.openPlayStore(); }}
              activeOpacity={0.8}
            >
              <Text style={styles.installBtnText}>Installa Speechnotes dal Play Store</Text>
            </TouchableOpacity>
          )
        ) : null}

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            NasoSan Player — lettore musicale retro cassetta
          </Text>
          <Text style={styles.infoText}>
            Riproduce file locali. Nessun dato inviato online.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.background,
  },
  scroll: {
    flex: 1,
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
  headerTitle: {
    flex: 1,
    color: C.text,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    color: C.borderInput,
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
  card: {
    backgroundColor: C.panels,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.separators,
    padding: 14,
  },
  folderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  led: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  ledGreen: { backgroundColor: C.playGreen },
  ledRed: { backgroundColor: C.error },
  ledYellow: { backgroundColor: C.warning },
  speechnoteBtn: {
    width: 44,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  speechnoteBtnRed: { backgroundColor: C.errorBg, borderColor: C.error },
  speechnoteBtnYellow: { backgroundColor: "#2a2010", borderColor: C.warning },
  speechnoteBtnGreen: { backgroundColor: "#102010", borderColor: C.ok },
  speechnoteBtnText: { color: C.text, fontSize: 11, fontWeight: "600" as const },
  folderInfo: {
    flex: 1,
    gap: 4,
  },
  folderName: {
    color: C.text,
    fontSize: 15,
    fontWeight: "500",
  },
  folderSub: {
    color: C.borderInput,
    fontSize: 12,
  },
  primaryBtn: {
    backgroundColor: C.playGreen,
    borderColor: C.playBorder,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryBtnIcon: { fontSize: 18 },
  primaryBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.errorBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.error,
    padding: 12,
    gap: 8,
  },
  errorIcon: { fontSize: 16, color: C.error },
  errorText: { color: C.error, fontSize: 13, flex: 1 },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.errorBg,
    borderColor: C.error,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 12,
    gap: 8,
  },
  dangerIcon: { fontSize: 16 },
  dangerBtnText: {
    color: C.error,
    fontSize: 15,
    fontWeight: "500",
  },
  installBtn: {
    backgroundColor: "#2a2010",
    borderColor: C.warning,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  installBtnText: {
    color: C.warning,
    fontSize: 14,
    fontWeight: "500" as const,
  },
  infoBox: {
    paddingTop: 20,
    alignItems: "center",
    gap: 4,
  },
  infoText: {
    color: C.separators,
    fontSize: 11,
    textAlign: "center",
  },
});
