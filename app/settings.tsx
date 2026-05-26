import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { usePlayer } from "@/context/PlayerContext";

function LedIndicator({ active }: { active: boolean }) {
  return (
    <View style={[styles.led, active ? styles.ledGreen : styles.ledRed]} />
  );
}

function StatusBanner({ status }: { status: "success" | "invalid" | "busy" | "exported" | "notfound" | null }) {
  if (!status) return null;
  const isError = status === "invalid" || status === "notfound";
  const isBusy = status === "busy";
  const text = isBusy ? "…" : isError ? "Errore" : "OK";
  return (
    <View style={[
      styles.banner,
      isError ? styles.bannerError : isBusy ? styles.bannerBusy : styles.bannerOk,
    ]}>
      <Text style={[styles.bannerText, isError && styles.bannerTextError]}>{text}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const {
    folderUri,
    folderName,
    tracks,
    pickFolder,
    clearFolder,
    exportBackup,
    importBackup,
    backupFolderUri,
    backupFolderName,
    pickBackupFolder,
    clearBackupFolder,
    autoBackupIntervalMs,
    setAutoBackupIntervalMs,
    pauseForScreen,
    resumeAfterScreen,
  } = usePlayer();

  const AUTO_BACKUP_OPTIONS: { label: string; ms: number }[] = [
    { label: "Off", ms: 0 },
    { label: "5 min", ms: 5 * 60 * 1000 },
    { label: "10 min", ms: 10 * 60 * 1000 },
    { label: "30 min", ms: 30 * 60 * 1000 },
  ];

  useFocusEffect(
    React.useCallback(() => {
      pauseForScreen();
      return () => { resumeAfterScreen(); };
    }, [pauseForScreen, resumeAfterScreen])
  );

  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [backupStatus, setBackupStatus] = React.useState<"success" | "invalid" | "busy" | "exported" | "notfound" | null>(null);

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

  async function handlePickBackupFolder() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await pickBackupFolder();
  }

  async function handleClearBackupFolder() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await clearBackupFolder();
  }

  async function handleExport() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBackupStatus("busy");
    try {
      await exportBackup();
      setBackupStatus("exported");
      setTimeout(() => setBackupStatus(null), 3000);
    } catch {
      setBackupStatus(null);
    }
  }

  async function handleImport() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBackupStatus("busy");
    try {
      const result = await importBackup();
      setBackupStatus(result);
      if (result === "success") {
        setTimeout(() => setBackupStatus(null), 3000);
      }
    } catch {
      setBackupStatus("invalid");
    }
  }

  return (
    <View style={[styles.root, { paddingTop: topPad, paddingBottom: botPad + 12 }]}>
      {/* Header */}
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

        {/* Inserisci / cambia cassetta */}
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

        {/* FORMATI SUPPORTATI */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>FORMATI SUPPORTATI</Text>
          <View style={styles.card}>
            <Text style={styles.formatText}>
              MP3 · FLAC · AAC · OGG · WAV · M4A · OPUS · WMA · APE
            </Text>
          </View>
        </View>

        {/* CARTELLA BACKUP AUTOMATICO */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CARTELLA BACKUP AUTOMATICO</Text>
          <View style={styles.card}>
            <View style={styles.folderRow}>
              <LedIndicator active={!!backupFolderUri} />
              <View style={styles.folderInfo}>
                <Text style={styles.folderName} numberOfLines={1}>
                  {backupFolderUri
                    ? (backupFolderName || "Cartella selezionata")
                    : "Download (predefinita)"}
                </Text>
                <Text style={styles.folderSub}>
                  {backupFolderUri
                    ? "Backup automatico in questa cartella"
                    : "Tenta /storage/emulated/0/Download/"}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.backupRow}>
            <TouchableOpacity
              style={styles.backupBtn}
              onPress={handlePickBackupFolder}
              activeOpacity={0.8}
            >
              <Text style={styles.backupBtnIcon}>{"+"}</Text>
              <Text style={styles.backupBtnText}>Scegli cartella</Text>
            </TouchableOpacity>
            {backupFolderUri ? (
              <TouchableOpacity
                style={[styles.backupBtn, styles.backupBtnDanger]}
                onPress={handleClearBackupFolder}
                activeOpacity={0.8}
              >
                <Text style={styles.backupBtnIconDanger}>{"x"}</Text>
                <Text style={styles.backupBtnTextDanger}>Usa Download</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* BACKUP AUTOMATICO */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BACKUP AUTOMATICO</Text>
          <View style={styles.card}>
            <Text style={styles.backupDesc}>
              Salva in automatico in cache locale. Usa "Esporta" per copiarlo nella cartella selezionata.
            </Text>
            <View style={styles.intervalRow}>
              {AUTO_BACKUP_OPTIONS.map(opt => {
                const active = autoBackupIntervalMs === opt.ms;
                return (
                  <TouchableOpacity
                    key={opt.ms}
                    style={[styles.intervalBtn, active && styles.intervalBtnActive]}
                    onPress={() => setAutoBackupIntervalMs(opt.ms)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.intervalBtnText, active && styles.intervalBtnTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* BACKUP DATI */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>BACKUP DATI</Text>
          <View style={styles.card}>
            <Text style={styles.backupDesc}>
              Salva o ripristina posizioni, preferiti e ordine shuffle di tutte le cassette.
              Utile per cambiare telefono o dopo una reinstallazione.
            </Text>
            <View style={styles.backupLocationRow}>
              <Text style={styles.backupLocationLabel}>Cartella: </Text>
              <Text style={styles.backupLocationValue} numberOfLines={1}>
                {backupFolderName || "Download"}
              </Text>
            </View>
            <View style={styles.backupLocationRow}>
              <Text style={styles.backupLocationLabel}>File:     </Text>
              <Text style={styles.backupLocationValue} numberOfLines={1}>
                NasoSanPlayer_Backup.json
              </Text>
            </View>
          </View>
          <View style={styles.backupRow}>
            <TouchableOpacity
              style={[styles.backupBtn, backupStatus === "busy" && styles.backupBtnDisabled]}
              onPress={handleExport}
              disabled={backupStatus === "busy"}
              activeOpacity={0.8}
            >
              <Text style={styles.backupBtnIcon}>{"▲"}</Text>
              <Text style={styles.backupBtnText}>Esporta</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.backupBtn, backupStatus === "busy" && styles.backupBtnDisabled]}
              onPress={handleImport}
              disabled={backupStatus === "busy"}
              activeOpacity={0.8}
            >
              <Text style={styles.backupBtnIcon}>{"▼"}</Text>
              <Text style={styles.backupBtnText}>Ripristina</Text>
            </TouchableOpacity>
          </View>
          <StatusBanner status={backupStatus} />
        </View>

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

        {/* Info */}
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
    backgroundColor: "#1e1e26",
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
    borderBottomColor: "#3a3a4a",
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: {
    color: "#64c8ff",
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "300",
  },
  headerTitle: {
    flex: 1,
    color: "#c8c8d2",
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
    color: "#4a4a5a",
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "600",
  },
  card: {
    backgroundColor: "#2a2a36",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3a3a4a",
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
  ledGreen: { backgroundColor: "#149650" },
  ledRed: { backgroundColor: "#e05555" },
  folderInfo: {
    flex: 1,
    gap: 4,
  },
  folderName: {
    color: "#c8c8d2",
    fontSize: 15,
    fontWeight: "500",
  },
  folderSub: {
    color: "#4a4a5a",
    fontSize: 12,
  },
  primaryBtn: {
    backgroundColor: "#149650",
    borderColor: "#1db060",
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
    backgroundColor: "#2a1616",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e05555",
    padding: 12,
    gap: 8,
  },
  errorIcon: { fontSize: 16, color: "#e05555" },
  errorText: { color: "#e05555", fontSize: 13, flex: 1 },
  formatText: {
    color: "#8cc8ff",
    fontSize: 13,
    lineHeight: 20,
  },
  backupDesc: {
    color: "#8cc8ff",
    fontSize: 12,
    lineHeight: 18,
  },
  intervalRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  intervalBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3a3a4a",
    backgroundColor: "#1e1e26",
  },
  intervalBtnActive: {
    borderColor: "#64c8ff",
    backgroundColor: "#1a2a3a",
  },
  intervalBtnText: {
    color: "#4a4a5a",
    fontSize: 13,
    fontWeight: "500",
  },
  intervalBtnTextActive: {
    color: "#64c8ff",
  },
  backupLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    flexWrap: "nowrap",
  },
  backupLocationLabel: {
    color: "#4a4a5a",
    fontSize: 11,
    fontFamily: "monospace" as const,
    flexShrink: 0,
  },
  backupLocationValue: {
    color: "#64c8ff",
    fontSize: 11,
    fontFamily: "monospace" as const,
    flex: 1,
  },
  backupRow: {
    flexDirection: "row",
    gap: 10,
  },
  backupBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#1a2a3a",
    borderColor: "#64c8ff",
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 12,
  },
  backupBtnDisabled: {
    opacity: 0.4,
  },
  backupBtnDanger: {
    borderColor: "#e05555",
    backgroundColor: "#2a1616",
  },
  backupBtnIcon: {
    color: "#64c8ff",
    fontSize: 14,
  },
  backupBtnIconDanger: {
    color: "#e05555",
    fontSize: 14,
  },
  backupBtnText: {
    color: "#64c8ff",
    fontSize: 15,
    fontWeight: "500",
  },
  backupBtnTextDanger: {
    color: "#e05555",
    fontSize: 15,
    fontWeight: "500",
  },
  banner: {
    borderRadius: 8,
    padding: 10,
    alignItems: "center",
  },
  bannerOk: { backgroundColor: "#1a3a1a", borderWidth: 1, borderColor: "#149650" },
  bannerError: { backgroundColor: "#2a1616", borderWidth: 1, borderColor: "#e05555" },
  bannerBusy: { backgroundColor: "#1a2a3a", borderWidth: 1, borderColor: "#64c8ff" },
  bannerText: { color: "#c8c8d2", fontSize: 13 },
  bannerTextError: { color: "#e05555" },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2a1616",
    borderColor: "#e05555",
    borderWidth: 1.5,
    borderRadius: 8,
    paddingVertical: 12,
    gap: 8,
  },
  dangerIcon: { fontSize: 16 },
  dangerBtnText: {
    color: "#e05555",
    fontSize: 15,
    fontWeight: "500",
  },
  infoBox: {
    paddingTop: 20,
    alignItems: "center",
    gap: 4,
  },
  infoText: {
    color: "#3a3a4a",
    fontSize: 11,
    textAlign: "center",
  },
});
