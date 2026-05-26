import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { initSounds, playSound } from "@/utils/SoundManager";
import { readID3Tags } from "@/utils/ID3Parser";
import { convertWma, isWma, preConvertWmaFiles } from "@/utils/WmaConverter";
import { VolumeAnalyzer } from "@/utils/VolumeAnalyzer";
import { updateAutoState } from "@/utils/TrackCache";
import { getSilentPlaceholderUri } from "@/utils/SilentPlaceholder";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus, BackHandler, Image } from "react-native";
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  State,
  useActiveTrack,
  usePlaybackState,
  useProgress,
} from "react-native-track-player";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SAF = (FileSystem as any).StorageAccessFramework as {
  requestDirectoryPermissionsAsync: () => Promise<{ granted: boolean; directoryUri: string }>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
};

const AUDIO_EXTS = /\.(mp3|flac|ogg|aac|m4a|wav|opus|wma)$/i;

const NASOSAN_ARTWORK = require("../assets/images/nasosan_logo_full.png");
const NASOSAN_ARTWORK_URI: string = Image.resolveAssetSource(NASOSAN_ARTWORK).uri;


export interface Track {
  id: number;
  filename: string;
  uri: string;
  title: string;
  artist: string;
  positionMs: number;
  favorite: boolean;
}

interface FolderData {
  tracks: Track[];
  shuffleOrder: number[];
  currentTrackId: number | null;
  trackEdits?: Record<string, { title: string; artist: string }>;
}

interface BackupFolder extends FolderData {
  folderName: string;
  folderUri: string;
}

interface BackupFile {
  version: number;
  exportDate: string;
  settings: { shuffleMode: boolean; favoritesMode: boolean };
  folders: BackupFolder[];
  gains?: Record<string, Record<string, number>>;
}

interface PlayerContextType {
  folderUri: string | null;
  folderName: string;
  tracks: Track[];
  currentTrackId: number | null;
  currentTrack: Track | null;
  isPlaying: boolean;
  isPaused: boolean;
  shuffleMode: boolean;
  favoritesMode: boolean;
  shuffleOrder: number[];
  playbackPositionMs: number;
  playbackDurationMs: number;
  stopCountdown: number | null;
  showNoFavoritesMsg: boolean;
  activeList: Track[];
  currentIndexInActive: number;
  sideACount: number;
  currentSide: "A" | "B";
  currentIndexInSide: number;
  sideProgress: number;
  pickFolder: () => Promise<void>;
  clearFolder: () => void;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seekToTrack: (trackId: number, autoPlay?: boolean) => Promise<void>;
  editTrackMeta: (id: number, title: string, artist: string) => Promise<void>;
  isFF: boolean;
  isRW: boolean;
  startFF: () => void;
  stopFF: () => void;
  startRW: () => void;
  stopRW: () => void;
  toggleShuffle: () => void;
  regenerateShuffle: () => void;
  toggleFavorites: () => void;
  toggleFavorite: (trackId: number) => void;
  isWmaConverting: boolean;
  normalizeGains: () => Promise<void>;
  isNormalizing: boolean;
  normalizationActive: boolean;
  normalizingProgress: { current: number; total: number } | null;
  clearNormalization: () => void;
  resetNormalization: () => Promise<void>;
  cancelStop: () => void;
  pauseForScreen: () => Promise<void>;
  resumeAfterScreen: () => Promise<void>;
  exportBackup: () => Promise<string | null>;
  importBackup: () => Promise<"success" | "invalid" | "notfound">;
  backupFolderUri: string | null;
  backupFolderName: string | null;
  pickBackupFolder: () => Promise<void>;
  clearBackupFolder: () => void;
  autoBackupIntervalMs: number;
  setAutoBackupIntervalMs: (ms: number) => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}

function parseFilename(filename: string): { title: string; artist: string } {
  const base = filename.replace(AUDIO_EXTS, "").replace(/_/g, " ").trim();
  const idx = base.indexOf(" - ");
  if (idx > 0) {
    return { artist: base.substring(0, idx).trim(), title: base.substring(idx + 3).trim() };
  }
  return { title: base, artist: "" };
}

function extractFilename(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const parts = decoded.split("/");
  return parts[parts.length - 1] || decoded;
}

function getFolderName(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const parts = decoded.split(/[/:%]/);
  return parts.filter(Boolean).pop() || "Cassetta";
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const STORAGE_KEY_FOLDER = "@nasosan_folder";
const STORAGE_KEY_BACKUP_FOLDER = "@nasosan_backup_folder";
const STORAGE_KEY_DATA = (folderUri: string) =>
  `@nasosan_data_${encodeURIComponent(folderUri)}`;
const STORAGE_KEY_GAINS = (folderUri: string) =>
  `@nasosan_gains_${encodeURIComponent(folderUri)}`;
const STORAGE_KEY_RMS = (folderUri: string) =>
  `@nasosan_rms_${encodeURIComponent(folderUri)}`;
const STORAGE_KEY_SETTINGS = "@nasosan_settings";

let rtpReady = false;

export async function ensureRtpSetup() {
  if (rtpReady) return;
  try {
    await TrackPlayer.setupPlayer({
      minBuffer: 3,
      maxBuffer: 10,
      playBuffer: 1,
      backBuffer: 2,
      waitForBuffer: true,
      autoHandleInterruptions: true,
    });
    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
        Capability.JumpForward,
        Capability.JumpBackward,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.Stop,
      ],
      android: {
        appKilledPlaybackBehavior:
          AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
      },
      progressUpdateEventInterval: 500,
    });
    rtpReady = true;
  } catch (e) {
    // setupPlayer may throw if already set up — treat as ready
    rtpReady = true;
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [folderUri, setFolderUri] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string>("NasoSan");
  const [backupFolderUri, setBackupFolderUri] = useState<string | null>(null);
  const [backupFolderName, setBackupFolderName] = useState<string | null>(null);
  const backupFolderUriRef = useRef<string | null>(null);
  const backupFolderNameRef = useRef<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFF, setIsFF] = useState(false);
  const [isRW, setIsRW] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [favoritesMode, setFavoritesMode] = useState(false);
  const [autoBackupIntervalMs, setAutoBackupIntervalMs] = useState(5 * 60 * 1000);
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  const [playbackPositionMs, setPlaybackPositionMs] = useState(0);
  const [playbackDurationMs, setPlaybackDurationMs] = useState(0);
  const [stopCountdown, setStopCountdown] = useState<number | null>(null);
  const [showNoFavoritesMsg, setShowNoFavoritesMsg] = useState(false);
  const [trackEdits, setTrackEdits] = useState<Record<string, { title: string; artist: string }>>({});

  const ffIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rwIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ffSpeedRef = useRef(2);
  const rwSpeedRef = useRef(2);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopEndTimeRef = useRef<number | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const currentTrackIdRef = useRef<number | null>(null);
  const shuffleModeRef = useRef(false);
  const favoritesModeRef = useRef(false);
  const shuffleOrderRef = useRef<number[]>([]);
  const folderUriRef = useRef<string | null>(null);
  const folderNameRef = useRef<string>("NasoSan");
  const isPlayingRef = useRef(false);
  const isPausedRef = useRef(false);
  const playbackPositionMsRef = useRef(0);
  const skipManualRef = useRef(false);
  const wasPlayingBeforeScreenRef = useRef(false);
  const trackEditsRef = useRef<Record<string, { title: string; artist: string }>>({});
  const wmaFailedRef = useRef<Set<number>>(new Set());
  const wmaConvertingRef = useRef<Set<number>>(new Set());
  const wmaConvertedRef = useRef<Set<number>>(new Set());
  const wmaConvertingCountRef = useRef(0);
  const [isWmaConverting, setIsWmaConverting] = useState(false);
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [normalizationActive, setNormalizationActive] = useState(false);
  const [normalizingProgress, setNormalizingProgress] = useState<{ current: number; total: number } | null>(null);
  const trackGainsRef = useRef<Map<string, number>>(new Map());
  const normalizeGainsRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { currentTrackIdRef.current = currentTrackId; }, [currentTrackId]);
  useEffect(() => { shuffleModeRef.current = shuffleMode; }, [shuffleMode]);
  useEffect(() => { favoritesModeRef.current = favoritesMode; }, [favoritesMode]);
  useEffect(() => { shuffleOrderRef.current = shuffleOrder; }, [shuffleOrder]);
  useEffect(() => { folderUriRef.current = folderUri; }, [folderUri]);
  useEffect(() => { folderNameRef.current = folderName; }, [folderName]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { playbackPositionMsRef.current = playbackPositionMs; }, [playbackPositionMs]);

  // ── RNTP hooks ──────────────────────────────────────────────────────────────
  const rtpProgress = useProgress(500);
  const rtpPlaybackState = usePlaybackState();
  useActiveTrack(); // subscribed but handled via event

  useEffect(() => {
    const pos = Math.round(rtpProgress.position * 1000);
    const dur = Math.round(rtpProgress.duration * 1000);
    setPlaybackPositionMs(pos);
    setPlaybackDurationMs(dur);
    playbackPositionMsRef.current = pos;
  }, [rtpProgress.position, rtpProgress.duration]);

  useEffect(() => {
    const s = rtpPlaybackState.state;
    if (!s) return;
    const playing = s === State.Playing || s === State.Buffering || s === State.Loading;
    const paused = s === State.Paused || s === State.Ready;
    setIsPlaying(playing);
    isPlayingRef.current = playing;
    setIsPaused(!playing && paused);
    isPausedRef.current = !playing && paused;
  }, [rtpPlaybackState.state]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const getActiveList = useCallback((
    tks: Track[], sMode: boolean, fMode: boolean, sOrder: number[]
  ): Track[] => {
    let list: Track[];
    if (sMode && sOrder.length > 0) {
      list = sOrder.map(id => tks.find(t => t.id === id)).filter(Boolean) as Track[];
    } else {
      list = [...tks];
    }
    if (fMode) list = list.filter(t => t.favorite);
    return list;
  }, []);

  const activeList = getActiveList(tracks, shuffleMode, favoritesMode, shuffleOrder);
  const rawCurrentTrack = tracks.find(t => t.id === currentTrackId) ?? null;
  const currentTrack = rawCurrentTrack
    ? (trackEdits[String(rawCurrentTrack.id)]
        ? { ...rawCurrentTrack, ...trackEdits[String(rawCurrentTrack.id)] }
        : rawCurrentTrack)
    : null;
  const currentIndexInActive = activeList.findIndex(t => t.id === currentTrackId);
  const nActive = activeList.length;
  const sideACount = Math.ceil(nActive / 2);
  const safeActiveIndex = currentIndexInActive >= 0 ? currentIndexInActive : 0;
  const currentSide: "A" | "B" = (nActive === 0 || safeActiveIndex < sideACount) ? "A" : "B";
  const sideProgress = nActive > 1 ? safeActiveIndex / (nActive - 1) : 0;
  const currentIndexInSide = currentSide === "A" ? safeActiveIndex : safeActiveIndex - sideACount;

  // ── Persistence helpers ──────────────────────────────────────────────────────
  const saveCurrentPosition = useCallback(async () => {
    const id = currentTrackIdRef.current;
    const pos = playbackPositionMsRef.current;
    if (id == null) return;
    setTracks(prev => {
      const updated = prev.map(t => t.id === id ? { ...t, positionMs: pos } : t);
      tracksRef.current = updated;
      return updated;
    });
  }, []);

  const saveFolderData = useCallback(async (
    uri: string, tks: Track[], sOrder: number[], curId: number | null
  ) => {
    if (!uri) return;
    const data: FolderData = { tracks: tks, shuffleOrder: sOrder, currentTrackId: curId, trackEdits: trackEditsRef.current };
    await AsyncStorage.setItem(STORAGE_KEY_DATA(uri), JSON.stringify(data));
  }, []);

  const autoBackupIntervalMsRef = useRef(5 * 60 * 1000);
  useEffect(() => { autoBackupIntervalMsRef.current = autoBackupIntervalMs; }, [autoBackupIntervalMs]);

  const saveSettings = useCallback(async (sMode: boolean, fMode: boolean) => {
    await AsyncStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({
      shuffleMode: sMode,
      favoritesMode: fMode,
      autoBackupIntervalMs: autoBackupIntervalMsRef.current,
    }));
  }, []);

  // ── RNTP queue sync ──────────────────────────────────────────────────────────
  const syncQueueToActiveList = useCallback(async (
    active: Track[], currentId: number | null, startPlaying = false
  ) => {
    wmaConvertedRef.current.clear();
    const silentUri = await getSilentPlaceholderUri();
    const rtTracks = active.map(t => ({
      id: String(t.id),
      url: isWma(t.uri) ? silentUri : t.uri,
      title: t.title || t.filename,
      artist: t.artist || "NasoSan",
      artwork: NASOSAN_ARTWORK_URI,
      album: folderNameRef.current || "NasoSan Player",
    }));

    skipManualRef.current = true;
    await TrackPlayer.reset();
    if (rtTracks.length === 0) { skipManualRef.current = false; return; }
    await TrackPlayer.add(rtTracks);

    const currentIdx = currentId != null ? active.findIndex(t => t.id === currentId) : -1;
    const startIdx = currentIdx >= 0 ? currentIdx : 0;
    await TrackPlayer.skip(startIdx);

    const savedMs = tracksRef.current.find(t => t.id === (currentId ?? active[0]?.id))?.positionMs ?? 0;
    if (savedMs > 0) await TrackPlayer.seekTo(savedMs / 1000);

    skipManualRef.current = false;

    if (startPlaying) await TrackPlayer.play();
    preConvertWmaFiles(active.map(t => t.uri));
  }, []);

  // ── Helper WMA: converte e ricostruisce la coda con il WAV ───────────────────
  const convertAndPlayWma = useCallback(async (
    track: Track,
    idxInActive: number,
    savedMs: number,
    shouldPlay = true,
  ) => {
    wmaConvertingCountRef.current++;
    setIsWmaConverting(true);
    try {
      const wavUri = await convertWma(track.uri);
      const active = getActiveList(tracksRef.current, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
      const silentUri = await getSilentPlaceholderUri();
      const rtTracks = active.map(t => ({
        id: String(t.id),
        url: t.id === track.id ? wavUri : (isWma(t.uri) ? silentUri : t.uri),
        title: t.title || t.filename,
        artist: t.artist || "NasoSan",
        artwork: NASOSAN_ARTWORK_URI,
        album: folderNameRef.current || "NasoSan Player",
      }));
      skipManualRef.current = true;
      await TrackPlayer.reset();
      await TrackPlayer.add(rtTracks);
      await TrackPlayer.skip(idxInActive);
      if (savedMs > 0) await TrackPlayer.seekTo(savedMs / 1000);
      skipManualRef.current = false;
      if (shouldPlay) await TrackPlayer.play();
      wmaFailedRef.current.delete(track.id);
      wmaConvertedRef.current.add(track.id);
    } finally {
      wmaConvertingCountRef.current--;
      if (wmaConvertingCountRef.current === 0) setIsWmaConverting(false);
    }
  }, [getActiveList]);

  // ── RNTP event listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    const trackChangedSub = TrackPlayer.addEventListener(
      Event.PlaybackActiveTrackChanged,
      async ({ track }) => {
        if (!track) return;
        const trackId = parseInt(track.id ?? "0", 10);
        setCurrentTrackId(trackId);
        currentTrackIdRef.current = trackId;

        // Aggiorna cache Android Auto
        const autoTrack = tracksRef.current.find(t => t.id === trackId);
        if (autoTrack) {
          const autoActive = getActiveList(tracksRef.current, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
          updateAutoState(
            autoTrack.title || autoTrack.filename,
            autoTrack.artist || "NasoSan",
            autoActive.map(t => ({ title: t.title || t.filename, artist: t.artist || "NasoSan" }))
          );
        }

        if (trackGainsRef.current.size > 0) {
          const gTrack = tracksRef.current.find(t => t.id === trackId);
          if (gTrack) {
            const gain = trackGainsRef.current.get(gTrack.uri) ?? 0;
            VolumeAnalyzer.applyGain(gain).catch(() => {});
          }
        }

        if (skipManualRef.current) return;

        const originalTrack = tracksRef.current.find(t => t.id === trackId);
        const savedMs = originalTrack?.positionMs ?? 0;

        // Gestione WMA: auto-avanzamento coda → converti e ricostruisci
        if (originalTrack && isWma(originalTrack.uri)) {
          if (wmaFailedRef.current.has(trackId)) {
            try { await TrackPlayer.skipToNext(); await TrackPlayer.play(); } catch {}
            return;
          }
          if (wmaConvertingRef.current.has(trackId)) return;
          const active = getActiveList(tracksRef.current, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
          const idx = active.findIndex(t => t.id === trackId);
          wmaConvertingRef.current.add(trackId);
          convertAndPlayWma(originalTrack, idx >= 0 ? idx : 0, savedMs)
            .catch(() => {
              wmaFailedRef.current.add(trackId);
              TrackPlayer.skipToNext().then(() => TrackPlayer.play()).catch(() => {});
            })
            .finally(() => wmaConvertingRef.current.delete(trackId));
          return;
        }

        if (savedMs > 0) await TrackPlayer.seekTo(savedMs / 1000);
      }
    );

    const queueEndedSub = TrackPlayer.addEventListener(
      Event.PlaybackQueueEnded,
      async () => {
        if (shuffleModeRef.current) {
          const ids = tracksRef.current.map(t => t.id);
          const newOrder = shuffleArray(ids);
          setShuffleOrder(newOrder);
          shuffleOrderRef.current = newOrder;
          setTracks(prev => {
            const reset = prev.map(t => ({ ...t, positionMs: 0 }));
            tracksRef.current = reset;
            return reset;
          });
          const active = getActiveList(tracksRef.current, true, favoritesModeRef.current, newOrder);
          await syncQueueToActiveList(active, active[0]?.id ?? null, true);
          if (active[0]) {
            setCurrentTrackId(active[0].id);
            currentTrackIdRef.current = active[0].id;
          }
        } else {
          setIsPlaying(false);
          isPlayingRef.current = false;
          setIsPaused(false);
          isPausedRef.current = false;
          setTracks(prev => {
            const reset = prev.map(t => ({ ...t, positionMs: 0 }));
            tracksRef.current = reset;
            return reset;
          });
          const uri = folderUriRef.current;
          if (uri) {
            await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
          }
        }
      }
    );

    return () => {
      trackChangedSub.remove();
      queueEndedSub.remove();
    };
  }, [saveFolderData, getActiveList]);

  // ── Folder loading ────────────────────────────────────────────────────────────
  const loadFolderData = useCallback(async (
    uri: string, freshTracks: Track[]
  ): Promise<{ merged: Track[]; knownFilenames: Set<string>; savedEdits: Record<string, { title: string; artist: string }> }> => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DATA(uri));
    const knownFilenames = new Set<string>();
    if (!raw) return { merged: freshTracks, knownFilenames, savedEdits: {} };
    try {
      const data: FolderData = JSON.parse(raw);
      const merged = freshTracks.map(t => {
        const saved = data.tracks.find(s => s.filename === t.filename);
        if (saved) {
          knownFilenames.add(t.filename);
          return {
            ...t,
            positionMs: saved.positionMs,
            favorite: saved.favorite,
            title: saved.title || t.title,
            artist: saved.artist || t.artist,
          };
        }
        return t;
      });
      return { merged, knownFilenames, savedEdits: data.trackEdits ?? {} };
    } catch { return { merged: freshTracks, knownFilenames, savedEdits: {} }; }
  }, []);

  const loadSavedShuffleOrder = useCallback(async (uri: string, freshIds: number[]): Promise<number[]> => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DATA(uri));
    if (!raw) return [];
    try {
      const data: FolderData = JSON.parse(raw);
      const valid = data.shuffleOrder.filter(id => freshIds.includes(id));
      return valid.length === freshIds.length ? valid : [];
    } catch { return []; }
  }, []);

  const loadSavedCurrentTrack = useCallback(async (uri: string): Promise<number | null> => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DATA(uri));
    if (!raw) return null;
    try {
      const data: FolderData = JSON.parse(raw);
      return data.currentTrackId;
    } catch { return null; }
  }, []);

  const scanGenRef = useRef(0);

  const scanFolder = useCallback(async (uri: string, autoPlay = false) => {
    const gen = ++scanGenRef.current;
    try {
      const files = await SAF.readDirectoryAsync(uri);
      const audioFiles: string[] = files.filter((f: string) => AUDIO_EXTS.test(decodeURIComponent(f)));
      audioFiles.sort();
      const freshTracks: Track[] = audioFiles.map((fileUri: string, idx: number) => {
        const filename = extractFilename(fileUri);
        const { title, artist } = parseFilename(filename);
        return { id: idx + 1, filename, uri: fileUri, title, artist, positionMs: 0, favorite: false };
      });

      if (gen !== scanGenRef.current) return;

      const { merged: mergedTracks, knownFilenames, savedEdits } = await loadFolderData(uri, freshTracks);
      const savedShuffle = await loadSavedShuffleOrder(uri, mergedTracks.map(t => t.id));
      const savedCurrent = await loadSavedCurrentTrack(uri);

      if (gen !== scanGenRef.current) return;

      setTracks(mergedTracks);
      tracksRef.current = mergedTracks;
      setTrackEdits(savedEdits);
      trackEditsRef.current = savedEdits;

      let resolvedOrder: number[] = [];
      if (savedShuffle.length > 0) {
        setShuffleOrder(savedShuffle);
        shuffleOrderRef.current = savedShuffle;
        resolvedOrder = savedShuffle;
      }

      const validCurrent = mergedTracks.find(t => t.id === savedCurrent);
      const currentId = validCurrent?.id ?? (mergedTracks[0]?.id ?? null);
      if (currentId != null) {
        setCurrentTrackId(currentId);
        currentTrackIdRef.current = currentId;
      }

      // Nuova cassetta → reset cache WMA falliti/in corso/convertiti
      wmaFailedRef.current.clear();
      wmaConvertingRef.current.clear();
      wmaConvertedRef.current.clear();

      const active = getActiveList(mergedTracks, shuffleModeRef.current, favoritesModeRef.current, resolvedOrder);
      await syncQueueToActiveList(active, currentId, autoPlay);

      // ── Read ID3 tags for new (uncached) files ────────────────────────────
      const newTracks = mergedTracks.filter(t => !knownFilenames.has(t.filename));
      if (newTracks.length > 0) {
        let updatedTracks = [...tracksRef.current];
        for (const track of newTracks) {
          if (gen !== scanGenRef.current) break;
          const tags = await readID3Tags(track.uri);
          if (tags.title || tags.artist) {
            updatedTracks = updatedTracks.map(t =>
              t.id === track.id
                ? { ...t, title: tags.title || t.title, artist: tags.artist || t.artist }
                : t
            );
            setTracks([...updatedTracks]);
            tracksRef.current = updatedTracks;
          }
        }
        if (gen === scanGenRef.current && folderUriRef.current === uri) {
          await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
        }
      }

      // Auto-resume normalizzazione interrotta o analisi nuovi file
      try {
        const rmsRaw = await AsyncStorage.getItem(STORAGE_KEY_RMS(uri));
        if (rmsRaw && gen === scanGenRef.current) {
          const rmsStored: Record<string, number> = JSON.parse(rmsRaw);
          const hasNew = mergedTracks.some(t => !(t.filename in rmsStored));
          if (hasNew) {
            setTimeout(() => { normalizeGainsRef.current?.(); }, 1500);
          }
        }
      } catch {}

      // Aggiorna cache Android Auto con elenco cassetta
      const curId2 = currentId;
      const curTkAuto = mergedTracks.find(t => t.id === curId2);
      updateAutoState(
        curTkAuto?.title || curTkAuto?.filename || "",
        curTkAuto?.artist || "NasoSan",
        mergedTracks.map(t => ({ title: t.title || t.filename, artist: t.artist || "NasoSan" }))
      );
    } catch (e) {
      console.error("Error scanning folder:", e);
    }
  }, [loadFolderData, loadSavedShuffleOrder, loadSavedCurrentTrack, getActiveList, syncQueueToActiveList, saveFolderData]);

  // ── Initialisation ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      await ensureRtpSetup();
      await initSounds();

      const savedSettings = await AsyncStorage.getItem(STORAGE_KEY_SETTINGS);
      if (savedSettings) {
        try {
          const s = JSON.parse(savedSettings);
          setShuffleMode(!!s.shuffleMode);
          setFavoritesMode(!!s.favoritesMode);
          shuffleModeRef.current = !!s.shuffleMode;
          favoritesModeRef.current = !!s.favoritesMode;
          if (typeof s.autoBackupIntervalMs === "number") {
            setAutoBackupIntervalMs(s.autoBackupIntervalMs);
          }
        } catch {}
      }
      const savedBackupFolder = await AsyncStorage.getItem(STORAGE_KEY_BACKUP_FOLDER);
      if (savedBackupFolder) {
        try {
          const { uri, name } = JSON.parse(savedBackupFolder);
          setBackupFolderUri(uri);
          setBackupFolderName(name);
          backupFolderUriRef.current = uri;
          backupFolderNameRef.current = name;
        } catch {}
      }

      const savedFolder = await AsyncStorage.getItem(STORAGE_KEY_FOLDER);
      if (savedFolder) {
        try {
          const { uri, name } = JSON.parse(savedFolder);
          setFolderUri(uri);
          setFolderName(name);
          folderUriRef.current = uri;
          folderNameRef.current = name;
          await scanFolder(uri, true);
        } catch {}
      }
    })();

    return () => {
      TrackPlayer.reset().catch(() => {});
    };
  }, []);

  // ── Backup helpers (devono stare PRIMA dell'AppState useEffect) ──────────────
  const buildBackupJson = useCallback(async (): Promise<string> => {
    const allKeys = await AsyncStorage.getAllKeys();
    const nasosanKeys = allKeys.filter(
      (k) => k.startsWith("@nasosan_data_") || k === STORAGE_KEY_SETTINGS
    );
    const pairs = await AsyncStorage.multiGet(nasosanKeys);

    const folders: BackupFolder[] = [];
    let settings = { shuffleMode: false, favoritesMode: false };

    for (const [key, value] of pairs) {
      if (!value) continue;
      if (key === STORAGE_KEY_SETTINGS) {
        try { settings = JSON.parse(value); } catch {}
      } else {
        const encoded = key.replace("@nasosan_data_", "");
        const uri = decodeURIComponent(encoded);
        try {
          const data: FolderData = JSON.parse(value);
          folders.push({ folderName: getFolderName(uri), folderUri: uri, ...data });
        } catch {}
      }
    }

    const gainsKeys = allKeys.filter(k => k.startsWith("@nasosan_gains_"));
    const gainsPairs = await AsyncStorage.multiGet(gainsKeys);
    const gainsMap: Record<string, Record<string, number>> = {};
    for (const [key, value] of gainsPairs) {
      if (!value) continue;
      const uri = decodeURIComponent(key.replace("@nasosan_gains_", ""));
      try { gainsMap[uri] = JSON.parse(value); } catch {}
    }

    const backup: BackupFile = {
      version: 1,
      exportDate: new Date().toISOString(),
      settings,
      folders,
      gains: Object.keys(gainsMap).length > 0 ? gainsMap : undefined,
    };
    return JSON.stringify(backup, null, 2);
  }, []);

  const silentBackup = useCallback(async () => {
    // SAF e percorsi assoluti non sono accessibili in background su Android 10+.
    // Il backup automatico usa sempre la cache interna dell'app (sempre scrivibile).
    try {
      const json = await buildBackupJson();
      const fs = FileSystem as unknown as {
        cacheDirectory: string;
        writeAsStringAsync: (uri: string, content: string, opts?: object) => Promise<void>;
        EncodingType: { UTF8: string };
      };
      const cacheUri = `${fs.cacheDirectory}NasoSanPlayer_Backup.json`;
      await fs.writeAsStringAsync(cacheUri, json, { encoding: fs.EncodingType.UTF8 });
    } catch {}
  }, [buildBackupJson]);

  // ── AppState (background persistence + auto-backup) ──────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        await saveCurrentPosition();
        const uri = folderUriRef.current;
        if (uri) {
          await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
        }
      }
      if (state === "background") {
        await silentBackup();
      }
      if (state === "active") {
        if (stopEndTimeRef.current !== null) {
          const remaining = Math.max(0, Math.ceil((stopEndTimeRef.current - Date.now()) / 1000));
          setStopCountdown(remaining);
          if (remaining <= 0) {
            if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
            stopEndTimeRef.current = null;
            BackHandler.exitApp();
          }
        } else {
          // Nessun countdown attivo: azzera il valore residuo (stale) se presente
          setStopCountdown(null);
        }
      }
    });
    return () => sub.remove();
  }, [saveCurrentPosition, saveFolderData, silentBackup]);

  // ── Salva autoBackupIntervalMs nelle impostazioni quando cambia ───────────────
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_SETTINGS).then(raw => {
      try {
        const s = raw ? JSON.parse(raw) : {};
        AsyncStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ ...s, autoBackupIntervalMs }));
      } catch {}
    });
  }, [autoBackupIntervalMs]);

  // ── Backup periodico (intervallo configurabile) ───────────────────────────────
  useEffect(() => {
    if (autoBackupIntervalMs <= 0) return;
    const id = setInterval(() => { silentBackup(); }, autoBackupIntervalMs);
    return () => clearInterval(id);
  }, [silentBackup, autoBackupIntervalMs]);

  const normalizeGains = useCallback(async () => {
    if (!VolumeAnalyzer.isSupported || isNormalizing) return;
    const uri = folderUriRef.current;
    const tks = tracksRef.current;
    if (!uri || tks.length === 0) return;
    setIsNormalizing(true);
    setNormalizingProgress({ current: 0, total: tks.length });
    try {
      // Carica RMS già calcolati (ripresa dopo chiusura/cambio cassetta)
      let rmsStored: Record<string, number> = {};
      try {
        const rmsRaw = await AsyncStorage.getItem(STORAGE_KEY_RMS(uri));
        if (rmsRaw) rmsStored = JSON.parse(rmsRaw);
      } catch {}
      const rmsValues: Record<string, number> = { ...rmsStored };
      for (let i = 0; i < tks.length; i++) {
        const t = tks[i];
        setNormalizingProgress({ current: i + 1, total: tks.length });
        if (rmsValues[t.filename] !== undefined) continue; // già calcolato
        const rms = await VolumeAnalyzer.analyzeRMS(t.uri).catch(() => -40 as number);
        rmsValues[t.filename] = rms;
        await AsyncStorage.setItem(STORAGE_KEY_RMS(uri), JSON.stringify(rmsValues)).catch(() => {});
      }
      const rmsArr = tks.map(t => rmsValues[t.filename] ?? -40);
      const maxRms = Math.max(...rmsArr);
      const gainsMap = new Map<string, number>();
      tks.forEach((t, i) => { gainsMap.set(t.uri, Math.max(0, maxRms - rmsArr[i])); });
      trackGainsRef.current = gainsMap;
      setNormalizationActive(true);
      const gainsObj: Record<string, number> = {};
      gainsMap.forEach((v, k) => { gainsObj[k] = v; });
      await AsyncStorage.setItem(STORAGE_KEY_GAINS(uri), JSON.stringify(gainsObj));
      const curTk = tracksRef.current.find(t => t.id === currentTrackIdRef.current);
      if (curTk) {
        const gain = gainsMap.get(curTk.uri) ?? 0;
        await VolumeAnalyzer.applyGain(gain);
      }
    } finally {
      setIsNormalizing(false);
      setNormalizingProgress(null);
    }
  }, [isNormalizing]);

  // Sincronizza ref per uso da scanFolder (evita circular deps)
  useEffect(() => { normalizeGainsRef.current = normalizeGains; }, [normalizeGains]);

  // clearNormalization: solo disattiva, mantiene dati su storage (toggle OFF)
  const clearNormalization = useCallback(async () => {
    trackGainsRef.current = new Map();
    setNormalizationActive(false);
    await VolumeAnalyzer.applyGain(0).catch(() => {});
  }, []);

  // resetNormalization: cancella tutto e riparte da zero (long press 3s)
  const resetNormalization = useCallback(async () => {
    if (isNormalizing) return;
    const uri = folderUriRef.current;
    trackGainsRef.current = new Map();
    setNormalizationActive(false);
    setNormalizingProgress(null);
    await VolumeAnalyzer.applyGain(0).catch(() => {});
    if (uri) {
      await AsyncStorage.removeItem(STORAGE_KEY_GAINS(uri)).catch(() => {});
      await AsyncStorage.removeItem(STORAGE_KEY_RMS(uri)).catch(() => {});
    }
    normalizeGainsRef.current?.();
  }, [isNormalizing]);

  useEffect(() => {
    if (!folderUri) {
      trackGainsRef.current = new Map();
      setNormalizationActive(false);
      setNormalizingProgress(null);
      return;
    }
    (async () => {
      try {
        const rawGains = await AsyncStorage.getItem(STORAGE_KEY_GAINS(folderUri));
        if (rawGains) {
          const obj = JSON.parse(rawGains) as Record<string, number>;
          trackGainsRef.current = new Map(Object.entries(obj));
          setNormalizationActive(true);
        } else {
          trackGainsRef.current = new Map();
          setNormalizationActive(false);
        }
      } catch { /* ignore */ }
    })();
  }, [folderUri]);

  // ── Folder management ─────────────────────────────────────────────────────────
  const pickFolder = useCallback(async () => {
    try {
      const perms = await SAF.requestDirectoryPermissionsAsync();
      if (!perms.granted) return;
      const uri = perms.directoryUri;
      const name = getFolderName(uri);

      skipManualRef.current = true;
      await TrackPlayer.reset();
      skipManualRef.current = false;

      playSound("eject");
      setTimeout(() => playSound("insert"), 600);

      setFolderUri(uri);
      setFolderName(name);
      setShuffleOrder([]);
      setCurrentTrackId(null);
      setIsPlaying(false);
      setIsPaused(false);
      folderUriRef.current = uri;
      folderNameRef.current = name;

      await AsyncStorage.setItem(STORAGE_KEY_FOLDER, JSON.stringify({ uri, name }));
      await scanFolder(uri);
    } catch (e) {
      console.error("Error picking folder:", e);
    }
  }, [scanFolder]);

  const clearFolder = useCallback(async () => {
    playSound("eject");
    skipManualRef.current = true;
    await TrackPlayer.reset().catch(() => {});
    skipManualRef.current = false;

    setFolderUri(null);
    setFolderName("NasoSan");
    setTracks([]);
    setCurrentTrackId(null);
    setIsPlaying(false);
    setIsPaused(false);
    setShuffleOrder([]);
    setTrackEdits({});
    trackEditsRef.current = {};
    folderUriRef.current = null;
    trackGainsRef.current = new Map();
    setNormalizationActive(false);
    setNormalizingProgress(null);
    VolumeAnalyzer.applyGain(0).catch(() => {});
    await AsyncStorage.removeItem(STORAGE_KEY_FOLDER);
  }, []);

  const pickBackupFolder = useCallback(async () => {
    try {
      const perms = await SAF.requestDirectoryPermissionsAsync();
      if (!perms.granted) return;
      const uri = perms.directoryUri;
      const name = getFolderName(uri);
      setBackupFolderUri(uri);
      setBackupFolderName(name);
      backupFolderUriRef.current = uri;
      backupFolderNameRef.current = name;
      await AsyncStorage.setItem(STORAGE_KEY_BACKUP_FOLDER, JSON.stringify({ uri, name }));
    } catch (e) {
      console.error("Error picking backup folder:", e);
    }
  }, []);

  const clearBackupFolder = useCallback(async () => {
    setBackupFolderUri(null);
    setBackupFolderName(null);
    backupFolderUriRef.current = null;
    backupFolderNameRef.current = null;
    await AsyncStorage.removeItem(STORAGE_KEY_BACKUP_FOLDER);
  }, []);

  // ── Playback controls ─────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    stopEndTimeRef.current = null;
    setStopCountdown(null);

    const tks = tracksRef.current;
    if (!tks.length) return;

    const curId = currentTrackIdRef.current;
    const active = getActiveList(tks, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
    if (!active.length) return;

    const startIdx = curId != null ? active.findIndex(t => t.id === curId) : 0;
    const realIdx = startIdx >= 0 ? startIdx : 0;
    const startTrack = tracksRef.current.find(t => t.id === active[realIdx].id) ?? active[realIdx];

    // WMA: gestito prima del check coda per evitare play su URI grezzo
    if (isWma(startTrack.uri)) {
      // Pausa genuina: WAV confermato in coda → riprendi direttamente
      if (isPausedRef.current && wmaConvertedRef.current.has(startTrack.id)) {
        await TrackPlayer.play();
        return;
      }
      if (!wmaConvertingRef.current.has(startTrack.id)) {
        const savedMs = startTrack.positionMs ?? 0;
        wmaConvertingRef.current.add(startTrack.id);
        convertAndPlayWma(startTrack, realIdx, savedMs)
          .catch(() => { wmaFailedRef.current.add(startTrack.id); })
          .finally(() => wmaConvertingRef.current.delete(startTrack.id));
      }
      return;
    }

    // Non-WMA: flusso normale
    if (isPausedRef.current) {
      await TrackPlayer.play();
      return;
    }

    const queue = await TrackPlayer.getQueue();
    if (queue.length === 0) {
      await syncQueueToActiveList(active, curId, true);
    } else {
      await TrackPlayer.play();
    }
  }, [getActiveList, syncQueueToActiveList, convertAndPlayWma]);

  const pause = useCallback(async () => {
    await saveCurrentPosition();
    await TrackPlayer.pause();
  }, [saveCurrentPosition]);

  const stop = useCallback(async () => {
    // Secondo stop mentre il countdown è già attivo → chiudi subito (conferma uscita)
    if (stopEndTimeRef.current !== null) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      stopEndTimeRef.current = null;
      silentBackup().catch(() => {});
      BackHandler.exitApp();
      return;
    }
    await saveCurrentPosition();
    await TrackPlayer.pause();
    const uri = folderUriRef.current;
    if (uri) {
      await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
    }
    setIsPlaying(false);
    setIsPaused(false);
    const STOP_SECS = 30;
    stopEndTimeRef.current = Date.now() + STOP_SECS * 1000;
    setStopCountdown(STOP_SECS);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((stopEndTimeRef.current! - Date.now()) / 1000));
      setStopCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        stopEndTimeRef.current = null;
        silentBackup().catch(() => {});
        BackHandler.exitApp();
      }
    }, 500);
  }, [saveCurrentPosition, saveFolderData, silentBackup]);

  const editTrackMeta = useCallback(async (id: number, title: string, artist: string) => {
    const newEdits = { ...trackEditsRef.current, [String(id)]: { title, artist } };
    trackEditsRef.current = newEdits;
    setTrackEdits(newEdits);
    const uri = folderUriRef.current;
    if (uri) {
      await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
    }
    const active = getActiveList(tracksRef.current, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
    const idx = active.findIndex(t => t.id === id);
    if (idx >= 0) {
      try { await TrackPlayer.updateMetadataForTrack(idx, { title, artist }); } catch {}
    }
  }, [saveFolderData, getActiveList]);

  const cancelStop = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setStopCountdown(null);
  }, []);

  const pauseForScreen = useCallback(async () => {
    wasPlayingBeforeScreenRef.current = isPlayingRef.current;
    if (isPlayingRef.current) {
      await TrackPlayer.pause();
    }
  }, []);

  const resumeAfterScreen = useCallback(async () => {
    if (wasPlayingBeforeScreenRef.current) {
      wasPlayingBeforeScreenRef.current = false;
      await TrackPlayer.play();
    }
  }, []);

  const next = useCallback(async () => {
    const tks = tracksRef.current;
    const curId = currentTrackIdRef.current;
    const active = getActiveList(tks, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
    if (!active.length) return;

    await saveCurrentPosition();
    const uri = folderUriRef.current;
    if (uri) await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, curId);

    const idx = active.findIndex(t => t.id === curId);
    const nextIdx = (idx + 1) % active.length;
    const nextTrack = tracksRef.current.find(t => t.id === active[nextIdx].id) ?? active[nextIdx];
    const savedMs = nextTrack.positionMs ?? 0;

    setCurrentTrackId(active[nextIdx].id);
    currentTrackIdRef.current = active[nextIdx].id;
    setStopCountdown(null);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    if (isWma(nextTrack.uri)) {
      skipManualRef.current = true;
      await TrackPlayer.skip(nextIdx);
      skipManualRef.current = false;
      if (!wmaConvertingRef.current.has(nextTrack.id)) {
        wmaConvertingRef.current.add(nextTrack.id);
        convertAndPlayWma(nextTrack, nextIdx, savedMs)
          .catch(() => { wmaFailedRef.current.add(nextTrack.id); })
          .finally(() => wmaConvertingRef.current.delete(nextTrack.id));
      }
    } else {
      skipManualRef.current = true;
      await TrackPlayer.skip(nextIdx);
      if (savedMs > 0) await TrackPlayer.seekTo(savedMs / 1000);
      skipManualRef.current = false;
      await TrackPlayer.play();
    }
  }, [getActiveList, saveCurrentPosition, saveFolderData, convertAndPlayWma]);

  const prev = useCallback(async () => {
    const tks = tracksRef.current;
    const curId = currentTrackIdRef.current;
    const active = getActiveList(tks, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
    if (!active.length) return;

    await saveCurrentPosition();
    const uri = folderUriRef.current;
    if (uri) await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, curId);

    const idx = active.findIndex(t => t.id === curId);
    const prevIdx = idx <= 0 ? active.length - 1 : idx - 1;
    const prevTrack = tracksRef.current.find(t => t.id === active[prevIdx].id) ?? active[prevIdx];
    const savedMs = prevTrack.positionMs ?? 0;

    setCurrentTrackId(active[prevIdx].id);
    currentTrackIdRef.current = active[prevIdx].id;
    setStopCountdown(null);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    if (isWma(prevTrack.uri)) {
      skipManualRef.current = true;
      await TrackPlayer.skip(prevIdx);
      skipManualRef.current = false;
      if (!wmaConvertingRef.current.has(prevTrack.id)) {
        wmaConvertingRef.current.add(prevTrack.id);
        convertAndPlayWma(prevTrack, prevIdx, savedMs)
          .catch(() => { wmaFailedRef.current.add(prevTrack.id); })
          .finally(() => wmaConvertingRef.current.delete(prevTrack.id));
      }
    } else {
      skipManualRef.current = true;
      await TrackPlayer.skip(prevIdx);
      if (savedMs > 0) await TrackPlayer.seekTo(savedMs / 1000);
      skipManualRef.current = false;
      await TrackPlayer.play();
    }
  }, [getActiveList, saveCurrentPosition, saveFolderData, convertAndPlayWma]);

  const seekToTrack = useCallback(async (trackId: number, autoPlay?: boolean) => {
    const tks = tracksRef.current;
    const active = getActiveList(tks, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
    const idx = active.findIndex(t => t.id === trackId);
    if (idx < 0) return;

    await saveCurrentPosition();
    const targetTrack = tracksRef.current.find(t => t.id === trackId) ?? active[idx];
    const savedMs = targetTrack.positionMs ?? 0;
    const shouldPlay = autoPlay !== undefined ? autoPlay : true;

    setCurrentTrackId(trackId);
    currentTrackIdRef.current = trackId;
    setStopCountdown(null);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    if (isWma(targetTrack.uri)) {
      skipManualRef.current = true;
      await TrackPlayer.skip(idx);
      skipManualRef.current = false;
      if (!wmaConvertingRef.current.has(trackId)) {
        wmaConvertingRef.current.add(trackId);
        convertAndPlayWma(targetTrack, idx, savedMs, shouldPlay)
          .catch(() => { wmaFailedRef.current.add(trackId); })
          .finally(() => wmaConvertingRef.current.delete(trackId));
      }
    } else {
      skipManualRef.current = true;
      await TrackPlayer.skip(idx);
      if (savedMs > 0) await TrackPlayer.seekTo(savedMs / 1000);
      skipManualRef.current = false;
      if (shouldPlay) await TrackPlayer.play();
    }
  }, [getActiveList, saveCurrentPosition, convertAndPlayWma]);

  // ── FF / RW ───────────────────────────────────────────────────────────────────
  const startFF = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    stopEndTimeRef.current = null;
    setStopCountdown(null);
    setIsFF(true);
    ffSpeedRef.current = 2;
    if (ffIntervalRef.current) clearInterval(ffIntervalRef.current);
    ffIntervalRef.current = setInterval(async () => {
      const pos = await TrackPlayer.getPosition();
      const dur = await TrackPlayer.getDuration();
      if (!isFinite(dur)) return;
      const newPos = Math.min(pos + ffSpeedRef.current, dur);
      await TrackPlayer.seekTo(newPos);
      ffSpeedRef.current = Math.min(ffSpeedRef.current + 0.5, 10);
    }, 300);
  }, []);

  const stopFF = useCallback(() => {
    setIsFF(false);
    if (ffIntervalRef.current) { clearInterval(ffIntervalRef.current); ffIntervalRef.current = null; }
    ffSpeedRef.current = 2;
  }, []);

  const startRW = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    stopEndTimeRef.current = null;
    setStopCountdown(null);
    setIsRW(true);
    rwSpeedRef.current = 2;
    if (rwIntervalRef.current) clearInterval(rwIntervalRef.current);
    rwIntervalRef.current = setInterval(async () => {
      const pos = await TrackPlayer.getPosition();
      const newPos = Math.max(pos - rwSpeedRef.current, 0);
      await TrackPlayer.seekTo(newPos);
      rwSpeedRef.current = Math.min(rwSpeedRef.current + 0.5, 10);
    }, 300);
  }, []);

  const stopRW = useCallback(() => {
    setIsRW(false);
    if (rwIntervalRef.current) { clearInterval(rwIntervalRef.current); rwIntervalRef.current = null; }
    rwSpeedRef.current = 2;
  }, []);

  // ── Shuffle / Favorites ───────────────────────────────────────────────────────
  const toggleShuffle = useCallback(() => {
    setShuffleMode(prev => {
      const next = !prev;
      shuffleModeRef.current = next;

      let order = shuffleOrderRef.current;
      if (next && order.length === 0) {
        const ids = tracksRef.current.map(t => t.id);
        order = shuffleArray(ids);
        setShuffleOrder(order);
        shuffleOrderRef.current = order;
      }

      const newActive = getActiveList(tracksRef.current, next, favoritesModeRef.current, order);
      syncQueueToActiveList(newActive, currentTrackIdRef.current, isPlayingRef.current);
      saveSettings(next, favoritesModeRef.current);
      return next;
    });
  }, [getActiveList, syncQueueToActiveList, saveSettings]);

  const regenerateShuffle = useCallback(() => {
    const ids = tracksRef.current.map(t => t.id);
    const newOrder = shuffleArray(ids);
    setShuffleOrder(newOrder);
    shuffleOrderRef.current = newOrder;
    setShuffleMode(true);
    shuffleModeRef.current = true;

    const newActive = getActiveList(tracksRef.current, true, favoritesModeRef.current, newOrder);
    syncQueueToActiveList(newActive, currentTrackIdRef.current, isPlayingRef.current);
    saveSettings(true, favoritesModeRef.current);
  }, [getActiveList, syncQueueToActiveList, saveSettings]);

  const toggleFavorites = useCallback(() => {
    const tks = tracksRef.current;
    const hasFav = tks.some(t => t.favorite);
    if (!favoritesMode && !hasFav) {
      setShowNoFavoritesMsg(true);
      setTimeout(() => setShowNoFavoritesMsg(false), 3000);
      return;
    }
    setFavoritesMode(prev => {
      const next = !prev;
      favoritesModeRef.current = next;

      const newActive = getActiveList(tks, shuffleModeRef.current, next, shuffleOrderRef.current);
      syncQueueToActiveList(newActive, currentTrackIdRef.current, isPlayingRef.current);
      saveSettings(shuffleModeRef.current, next);
      return next;
    });
  }, [favoritesMode, getActiveList, syncQueueToActiveList, saveSettings]);

  const toggleFavorite = useCallback((trackId: number) => {
    setTracks(prev => {
      const updated = prev.map(t => t.id === trackId ? { ...t, favorite: !t.favorite } : t);
      tracksRef.current = updated;
      const uri = folderUriRef.current;
      if (uri) saveFolderData(uri, updated, shuffleOrderRef.current, currentTrackIdRef.current);
      return updated;
    });
  }, [saveFolderData]);

  // ── Backup / Restore ──────────────────────────────────────────────────────────
  const exportBackup = useCallback(async (): Promise<string | null> => {
    try {
      const json = await buildBackupJson();
      const fs = FileSystem as unknown as {
        cacheDirectory: string;
        writeAsStringAsync: (uri: string, content: string, opts?: object) => Promise<void>;
        deleteAsync: (uri: string, opts?: object) => Promise<void>;
        EncodingType: { UTF8: string };
        StorageAccessFramework: {
          createFileAsync: (folderUri: string, fileName: string, mimeType: string) => Promise<string>;
          readDirectoryAsync: (uri: string) => Promise<string[]>;
        };
      };
      const fileName = "NasoSanPlayer_Backup.json";
      const bkpUri = backupFolderUriRef.current;
      if (bkpUri) {
        try {
          // Elimina il file esistente prima di crearne uno nuovo (evita duplicati "(1).json")
          try {
            const existing = await fs.StorageAccessFramework.readDirectoryAsync(bkpUri);
            const found = existing.find((f: string) =>
              decodeURIComponent(f).toLowerCase().includes("nasosanplayer_backup")
            );
            if (found) await fs.deleteAsync(found, { idempotent: true });
          } catch {}
          const fileUri = await fs.StorageAccessFramework.createFileAsync(
            bkpUri, fileName, "application/json"
          );
          await fs.writeAsStringAsync(fileUri, json, { encoding: fs.EncodingType.UTF8 });
          return backupFolderNameRef.current || "cartella backup";
        } catch {}
      }
      try {
        const dlPath = `file:///storage/emulated/0/Download/${fileName}`;
        await fs.writeAsStringAsync(dlPath, json, { encoding: fs.EncodingType.UTF8 });
        return "Download";
      } catch {}
      const fallbackUri = `${fs.cacheDirectory}${fileName}`;
      await fs.writeAsStringAsync(fallbackUri, json, { encoding: fs.EncodingType.UTF8 });
      return null;
    } catch {
      return null;
    }
  }, [buildBackupJson]);

  const importBackup = useCallback(async (): Promise<"success" | "invalid" | "notfound"> => {
    const fs = FileSystem as unknown as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };
    const SAFfs = (FileSystem as any).StorageAccessFramework as {
      readDirectoryAsync: (uri: string) => Promise<string[]>;
    };

    let content: string | null = null;

    // 1. Cerca nella cartella backup selezionata (SAF)
    const bkpUri = backupFolderUriRef.current;
    if (bkpUri) {
      try {
        const files = await SAFfs.readDirectoryAsync(bkpUri);
        const found = files.find((f: string) =>
          decodeURIComponent(f).toLowerCase().includes("nasosanplayer_backup")
        );
        if (found) {
          content = await fs.readAsStringAsync(found);
        }
      } catch {}
    }

    // 2. Fallback: cartella Download
    if (content === null) {
      try {
        content = await fs.readAsStringAsync(
          "file:///storage/emulated/0/Download/NasoSanPlayer_Backup.json"
        );
      } catch {}
    }

    // 3. Fallback: cache interna (backup automatico)
    if (content === null) {
      try {
        const fs2 = FileSystem as unknown as { cacheDirectory: string; readAsStringAsync: (uri: string) => Promise<string> };
        content = await fs2.readAsStringAsync(`${fs2.cacheDirectory}NasoSanPlayer_Backup.json`);
      } catch {}
    }

    if (content === null) return "notfound";

    let backup: BackupFile;
    try { backup = JSON.parse(content); } catch { return "invalid"; }
    if (!backup.version || !Array.isArray(backup.folders)) return "invalid";

    // Ripristina impostazioni
    if (backup.settings) {
      await AsyncStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(backup.settings));
      const s = backup.settings;
      setShuffleMode(!!s.shuffleMode);
      setFavoritesMode(!!s.favoritesMode);
      shuffleModeRef.current = !!s.shuffleMode;
      favoritesModeRef.current = !!s.favoritesMode;
    }

    // Scrivi tutti i dati delle cartelle con chiave originale
    // + chiave corrente se il nome cartella coincide (cross-device)
    const items: [string, string][] = [];
    for (const folder of backup.folders) {
      const data: FolderData = {
        tracks: folder.tracks,
        shuffleOrder: folder.shuffleOrder,
        currentTrackId: folder.currentTrackId,
        trackEdits: folder.trackEdits,
      };
      const serialized = JSON.stringify(data);
      items.push([STORAGE_KEY_DATA(folder.folderUri), serialized]);
      if (
        folderUriRef.current &&
        folder.folderName === folderNameRef.current &&
        folder.folderUri !== folderUriRef.current
      ) {
        items.push([STORAGE_KEY_DATA(folderUriRef.current), serialized]);
      }
    }
    await AsyncStorage.multiSet(items);

    // Ripristina gains
    if (backup.gains) {
      const gainItems: [string, string][] = [];
      for (const [fUri, gains] of Object.entries(backup.gains)) {
        gainItems.push([STORAGE_KEY_GAINS(fUri), JSON.stringify(gains)]);
        const matchFolder = backup.folders.find(f => f.folderUri === fUri);
        if (
          folderUriRef.current &&
          matchFolder?.folderName === folderNameRef.current &&
          fUri !== folderUriRef.current
        ) {
          gainItems.push([STORAGE_KEY_GAINS(folderUriRef.current), JSON.stringify(gains)]);
        }
      }
      if (gainItems.length > 0) await AsyncStorage.multiSet(gainItems);
      if (folderUriRef.current) {
        const rawG = await AsyncStorage.getItem(STORAGE_KEY_GAINS(folderUriRef.current));
        if (rawG) {
          trackGainsRef.current = new Map(Object.entries(JSON.parse(rawG) as Record<string, number>));
          setNormalizationActive(true);
        }
      }
    }

    // Ricarica la cartella corrente se presente
    if (folderUriRef.current) {
      await scanFolder(folderUriRef.current, false);
    }

    return "success";
  }, [scanFolder]);

  return (
    <PlayerContext.Provider value={{
      folderUri,
      folderName,
      tracks,
      currentTrackId,
      currentTrack,
      isPlaying,
      isFF,
      isRW,
      isPaused,
      shuffleMode,
      favoritesMode,
      shuffleOrder,
      playbackPositionMs,
      playbackDurationMs,
      stopCountdown,
      showNoFavoritesMsg,
      activeList,
      currentIndexInActive,
      sideACount,
      currentSide,
      currentIndexInSide,
      sideProgress,
      pickFolder,
      clearFolder,
      play,
      pause,
      stop,
      next,
      prev,
      seekToTrack,
      startFF,
      stopFF,
      startRW,
      stopRW,
      toggleShuffle,
      regenerateShuffle,
      toggleFavorites,
      toggleFavorite,
      editTrackMeta,
      isWmaConverting,
      normalizeGains,
      isNormalizing,
      normalizationActive,
      normalizingProgress,
      clearNormalization,
      resetNormalization,
      cancelStop,
      pauseForScreen,
      resumeAfterScreen,
      exportBackup,
      importBackup,
      backupFolderUri,
      backupFolderName,
      pickBackupFolder,
      clearBackupFolder,
      autoBackupIntervalMs,
      setAutoBackupIntervalMs,
    }}>
      {children}
    </PlayerContext.Provider>
  );
}
