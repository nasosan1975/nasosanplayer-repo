import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { initSounds, playSound } from "@/utils/SoundManager";
import { readID3Tags } from "@/utils/ID3Parser";
import { VolumeAnalyzer } from "@/utils/VolumeAnalyzer";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus, BackHandler, DeviceEventEmitter, Image, NativeModules } from "react-native";

const TrackCache = NativeModules.TrackCache as {
  update(title: string, artist: string, queueJson: string): void;
} | undefined;

const CarModeModule = NativeModules.CarModeModule as {
  startListening(): void;
  stopListening(): void;
  isInCarMode(): Promise<boolean>;
} | undefined;

const NasoSanPlayer = NativeModules.NasoSanPlayer as {
  setup(options: object): Promise<void>;
  updateOptions(options: object): Promise<void>;
  reset(): Promise<void>;
  add(tracks: object[]): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  skip(index: number): Promise<void>;
  skipToNext(): Promise<void>;
  shutdown(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  getQueue(): Promise<object[]>;
  updateMetadataForTrack(index: number, metadata: { title: string; artist: string }): Promise<void>;
  getPlaybackState(): Promise<string>;
};

function useNasoSanProgress(intervalMs = 500) {
  const [progress, setProgress] = useState({ position: 0, duration: 0 });
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const [pos, dur] = await Promise.all([
          NasoSanPlayer.getPosition(),
          NasoSanPlayer.getDuration(),
        ]);
        setProgress({ position: pos, duration: dur });
      } catch {}
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return progress;
}

function useNasoSanPlaybackState() {
  const [state, setState] = useState<string | undefined>(undefined);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("nasosan-playback-state", (data: { state: string }) => {
      setState(data.state);
    });
    return () => sub.remove();
  }, []);
  return { state };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SAF = (FileSystem as any).StorageAccessFramework as {
  requestDirectoryPermissionsAsync: () => Promise<{ granted: boolean; directoryUri: string }>;
  readDirectoryAsync: (uri: string) => Promise<string[]>;
};

const AUDIO_EXTS = /\.(mp3|flac|ogg|aac|m4a|mp4|wav|opus|wma|3gp|amr|mid|midi)$/i;

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
  gains?: Record<string, number>;
  shuffleMode?: boolean;
  favoritesMode?: boolean;
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
  normalizeGains: () => Promise<void>;
  isNormalizing: boolean;
  normalizationActive: boolean;
  normalizationPending: boolean;
  normalizingProgress: { current: number; total: number } | null;
  clearNormalization: () => void;
  resetNormalization: () => Promise<void>;
  cancelNormalization: () => void;
  resetCassetteData: () => Promise<void>;
  cancelStop: () => void;
  pauseForScreen: () => Promise<void>;
  resumeAfterScreen: () => Promise<void>;
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

import { APP_NAME, DATA_FILENAME } from "@/constants/app";
const FOLDER_DATA_FILENAME = DATA_FILENAME;

async function findFolderDataUri(folderUri: string): Promise<string | null> {
  try {
    const files = await SAF.readDirectoryAsync(folderUri);
    return files.find((f: string) => decodeURIComponent(f).endsWith(FOLDER_DATA_FILENAME)) ?? null;
  } catch { return null; }
}

async function readFolderFile(folderUri: string): Promise<FolderData | null> {
  const fileUri = await findFolderDataUri(folderUri);
  if (!fileUri) return null;
  try {
    const raw = await (FileSystem as any).readAsStringAsync(fileUri);
    return JSON.parse(raw) as FolderData;
  } catch { return null; }
}

async function writeFolderFile(folderUri: string, data: FolderData): Promise<void> {
  try {
    const content = JSON.stringify(data);
    const existingUri = await findFolderDataUri(folderUri);
    if (existingUri) {
      await (FileSystem as any).writeAsStringAsync(existingUri, content);
    } else {
      const newUri = await (FileSystem as any).StorageAccessFramework.createFileAsync(
        folderUri, FOLDER_DATA_FILENAME, "application/json"
      );
      await (FileSystem as any).writeAsStringAsync(newUri, content);
    }
  } catch {}
}

const STORAGE_KEY_FOLDER = "@nasosan_folder";
const STORAGE_KEY_DATA = (folderUri: string) =>
  `@nasosan_data_${encodeURIComponent(folderUri)}`;
const STORAGE_KEY_GAINS = (folderUri: string) =>
  `@nasosan_gains_${encodeURIComponent(folderUri)}`;
const STORAGE_KEY_RMS = (folderUri: string) =>
  `@nasosan_rms_${encodeURIComponent(folderUri)}`;
// Mantenuto solo per lettura (migrazione da versioni precedenti)
const STORAGE_KEY_SETTINGS = "@nasosan_settings";

let rtpReady = false;

export async function ensureRtpSetup() {
  if (rtpReady) return;
  try {
    await NasoSanPlayer.setup({});
    rtpReady = true;
  } catch {
    // Non impostare rtpReady=true su fallimento — consente retry
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [folderUri, setFolderUri] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string>("NasoSan");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFF, setIsFF] = useState(false);
  const [isRW, setIsRW] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [favoritesMode, setFavoritesMode] = useState(false);
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

  const wasPlayingBeforeScreenRef = useRef(false);
  const preFilterTrackIdRef = useRef<number | null>(null);
  const trackEditsRef = useRef<Record<string, { title: string; artist: string }>>({});
  const [isNormalizing, setIsNormalizing] = useState(false);
  const [normalizationActive, setNormalizationActive] = useState(false);
  const [normalizationPending, setNormalizationPending] = useState(false);
  const [normalizingProgress, setNormalizingProgress] = useState<{ current: number; total: number } | null>(null);
  const trackGainsRef = useRef<Map<string, number>>(new Map());
  const cancelNormRef = useRef(false);
  const normalizeGainsRef = useRef<(() => Promise<void>) | null>(null);
  const isNormalizingRef = useRef(false);
  const normalizationPendingRef = useRef(false);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { currentTrackIdRef.current = currentTrackId; }, [currentTrackId]);
  useEffect(() => { shuffleModeRef.current = shuffleMode; }, [shuffleMode]);
  useEffect(() => { favoritesModeRef.current = favoritesMode; }, [favoritesMode]);
  useEffect(() => { isNormalizingRef.current = isNormalizing; }, [isNormalizing]);
  useEffect(() => { normalizationPendingRef.current = normalizationPending; }, [normalizationPending]);
  useEffect(() => { shuffleOrderRef.current = shuffleOrder; }, [shuffleOrder]);
  useEffect(() => { folderUriRef.current = folderUri; }, [folderUri]);
  useEffect(() => { folderNameRef.current = folderName; }, [folderName]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { playbackPositionMsRef.current = playbackPositionMs; }, [playbackPositionMs]);

  // ── Player hooks ─────────────────────────────────────────────────────────────
  const rtpProgress = useNasoSanProgress(500);
  const rtpPlaybackState = useNasoSanPlaybackState();

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
    const playing = s === "playing";
    const paused = s === "paused";
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
    const gainsObj: Record<string, number> = {};
    trackGainsRef.current.forEach((v, k) => { gainsObj[k] = v; });
    const data: FolderData = {
      tracks: tks,
      shuffleOrder: sOrder,
      currentTrackId: curId,
      trackEdits: trackEditsRef.current,
      gains: Object.keys(gainsObj).length > 0 ? gainsObj : undefined,
      shuffleMode: shuffleModeRef.current,
      favoritesMode: favoritesModeRef.current,
    };
    await AsyncStorage.setItem(STORAGE_KEY_DATA(uri), JSON.stringify(data));
    writeFolderFile(uri, data).catch(() => {});
  }, []);

  const saveSettings = useCallback(async () => {
    const uri = folderUriRef.current;
    if (!uri) return;
    await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
  }, [saveFolderData]);

  // ── RNTP queue sync ──────────────────────────────────────────────────────────
  const syncQueueToActiveList = useCallback(async (
    active: Track[], currentId: number | null, startPlaying = false
  ) => {
    const rtTracks = active.map(t => ({
      id: String(t.id),
      url: t.uri,
      title: t.title || t.filename,
      artist: t.artist || "NasoSan",
      artwork: NASOSAN_ARTWORK_URI,
      album: folderNameRef.current || APP_NAME,
    }));

    await NasoSanPlayer.reset();
    if (rtTracks.length === 0) { return; }
    await NasoSanPlayer.add(rtTracks);

    const currentIdx = currentId != null ? active.findIndex(t => t.id === currentId) : -1;
    const startIdx = currentIdx >= 0 ? currentIdx : 0;
    await NasoSanPlayer.skip(startIdx);

    const savedMs = tracksRef.current.find(t => t.id === (currentId ?? active[0]?.id))?.positionMs ?? 0;
    if (savedMs > 0) await NasoSanPlayer.seekTo(savedMs / 1000);

    const curTrack = rtTracks[startIdx];
    try {
      TrackCache?.update(
        curTrack?.title ?? "",
        curTrack?.artist ?? "",
        JSON.stringify(rtTracks.map(t => ({ id: t.id, title: t.title, artist: t.artist, url: t.url })))
      );
    } catch {}

    if (startPlaying) await NasoSanPlayer.play();
  }, []);

  // ── Car mode (Android Auto via cavo USB audio) ───────────────────────────────
  useEffect(() => {
    if (!CarModeModule) return;
    CarModeModule.startListening();
    const enterSub = DeviceEventEmitter.addListener("nasosan_car_enter", () => {
      NasoSanPlayer.play().catch(() => {});
    });
    const exitSub = DeviceEventEmitter.addListener("nasosan_car_exit", () => {
      NasoSanPlayer.pause().catch(() => {});
    });
    return () => {
      CarModeModule?.stopListening();
      enterSub.remove();
      exitSub.remove();
    };
  }, []);

  // ── Player event listeners ───────────────────────────────────────────────────
  useEffect(() => {
    const trackChangedSub = DeviceEventEmitter.addListener(
      "nasosan-active-track-changed",
      async ({ track, reason }: { track?: { id: string; title: string; artist: string }; reason: number }) => {
        if (!track) return;
        const trackId = parseInt(track.id ?? "0", 10);
        setCurrentTrackId(trackId);
        currentTrackIdRef.current = trackId;

        if (trackGainsRef.current.size > 0) {
          const gTrack = tracksRef.current.find(t => t.id === trackId);
          if (gTrack) {
            const gain = trackGainsRef.current.get(gTrack.uri) ?? 0;
            VolumeAnalyzer.applyGain(gain).catch(() => {});
          }
        }

        // reason 2=SEEK(manuale), 3=PLAYLIST_CHANGED → non ripristinare posizione
        if (reason === 2 || reason === 3) return;

        const originalTrack = tracksRef.current.find(t => t.id === trackId);
        const savedMs = originalTrack?.positionMs ?? 0;
        if (savedMs > 0) await NasoSanPlayer.seekTo(savedMs / 1000);
      }
    );

    const queueEndedSub = DeviceEventEmitter.addListener(
      "nasosan-queue-ended",
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

    const errorSub = DeviceEventEmitter.addListener(
      "nasosan-playback-error",
      async () => {
        try { await NasoSanPlayer.skipToNext(); await NasoSanPlayer.play(); } catch {}
      }
    );

    return () => {
      trackChangedSub.remove();
      queueEndedSub.remove();
      errorSub.remove();
    };
  }, [saveFolderData, getActiveList]);

  // ── Folder loading ────────────────────────────────────────────────────────────
  const loadFolderData = useCallback(async (
    uri: string, freshTracks: Track[], preloaded?: FolderData | null
  ): Promise<{ merged: Track[]; knownFilenames: Set<string>; savedEdits: Record<string, { title: string; artist: string }>; shuffleMode?: boolean; favoritesMode?: boolean }> => {
    const knownFilenames = new Set<string>();
    let data: FolderData | null = preloaded ?? null;
    if (!data) {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_DATA(uri));
      if (raw) { try { data = JSON.parse(raw); } catch {} }
    }
    if (!data) return { merged: freshTracks, knownFilenames, savedEdits: {} };
    const merged = freshTracks.map(t => {
      const saved = data!.tracks.find(s => s.filename === t.filename);
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
    return {
      merged,
      knownFilenames,
      savedEdits: data.trackEdits ?? {},
      shuffleMode: data.shuffleMode,
      favoritesMode: data.favoritesMode,
    };
  }, []);

  const loadSavedShuffleOrder = useCallback(async (uri: string, freshIds: number[], preloaded?: FolderData | null): Promise<number[]> => {
    let data: FolderData | null = preloaded ?? null;
    if (!data) {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_DATA(uri));
      if (raw) { try { data = JSON.parse(raw); } catch {} }
    }
    if (!data?.shuffleOrder) return [];
    const valid = data.shuffleOrder.filter(id => freshIds.includes(id));
    return valid.length === freshIds.length ? valid : [];
  }, []);

  const loadSavedCurrentTrack = useCallback(async (uri: string, preloaded?: FolderData | null): Promise<number | null> => {
    let data: FolderData | null = preloaded ?? null;
    if (!data) {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_DATA(uri));
      if (raw) { try { data = JSON.parse(raw); } catch {} }
    }
    return data?.currentTrackId ?? null;
  }, []);

  const scanGenRef = useRef(0);

  const scanFolder = useCallback(async (uri: string, autoPlay = false) => {
    const gen = ++scanGenRef.current;
    try {
      const savedFolderFile = await readFolderFile(uri).catch(() => null);
      const files = await SAF.readDirectoryAsync(uri);
      const audioFiles: string[] = files.filter((f: string) => AUDIO_EXTS.test(decodeURIComponent(f)));
      audioFiles.sort();
      const freshTracks: Track[] = audioFiles.map((fileUri: string, idx: number) => {
        const filename = extractFilename(fileUri);
        const { title, artist } = parseFilename(filename);
        return { id: idx + 1, filename, uri: fileUri, title, artist, positionMs: 0, favorite: false };
      });

      if (gen !== scanGenRef.current) return;

      const { merged: mergedTracks, knownFilenames, savedEdits, shuffleMode: savedShuffleMode, favoritesMode: savedFavoritesMode } = await loadFolderData(uri, freshTracks, savedFolderFile);
      const savedShuffle = await loadSavedShuffleOrder(uri, mergedTracks.map(t => t.id), savedFolderFile);
      const savedCurrent = await loadSavedCurrentTrack(uri, savedFolderFile);

      if (gen !== scanGenRef.current) return;

      setTracks(mergedTracks);
      tracksRef.current = mergedTracks;
      setTrackEdits(savedEdits);
      trackEditsRef.current = savedEdits;

      // Ripristina shuffle/fav dalla cassetta (sovrascrive i default)
      if (savedShuffleMode !== undefined) {
        setShuffleMode(savedShuffleMode);
        shuffleModeRef.current = savedShuffleMode;
      }
      if (savedFavoritesMode !== undefined) {
        setFavoritesMode(savedFavoritesMode);
        favoritesModeRef.current = savedFavoritesMode;
      }

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

    } catch (e) {
      console.error("Error scanning folder:", e);
    }
  }, [loadFolderData, loadSavedShuffleOrder, loadSavedCurrentTrack, getActiveList, syncQueueToActiveList, saveFolderData]);

  // ── Initialisation ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      await ensureRtpSetup();
      await initSounds();

      // Migrazione: legge settings da storage precedente (sovrascritta da folder JSON in scanFolder)
      const savedSettings = await AsyncStorage.getItem(STORAGE_KEY_SETTINGS);
      if (savedSettings) {
        try {
          const s = JSON.parse(savedSettings);
          setShuffleMode(!!s.shuffleMode);
          setFavoritesMode(!!s.favoritesMode);
          shuffleModeRef.current = !!s.shuffleMode;
          favoritesModeRef.current = !!s.favoritesMode;
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
      NasoSanPlayer.reset().catch(() => {});
    };
  }, []);

  // ── AppState (background persistence + sync stato riproduzione) ──────────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state: AppStateStatus) => {
      if (state === "background" || state === "inactive") {
        await saveCurrentPosition();
        const uri = folderUriRef.current;
        if (uri) {
          await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
        }
        if (isNormalizingRef.current && !isPlayingRef.current) {
          cancelNormRef.current = true;
          VolumeAnalyzer.cancelAnalysis();
        }
      }
      if (state === "active") {
        rtpReady = false;
        ensureRtpSetup().catch(() => {});
        // Sincronizza stato riproduzione dopo background (Android Auto, volante, ecc.)
        try {
          const s = await NasoSanPlayer.getPlaybackState();
          const playing = s === "playing";
          const paused = s === "paused";
          setIsPlaying(playing);
          isPlayingRef.current = playing;
          setIsPaused(paused);
          isPausedRef.current = paused;
        } catch {}
        const activeUri = folderUriRef.current;
        if (activeUri) {
          try {
            const files = await SAF.readDirectoryAsync(activeUri);
            const audioFiles = files
              .filter((f: string) => AUDIO_EXTS.test(decodeURIComponent(f)))
              .sort();
            const currentFilenames = tracksRef.current.map(t => t.filename).sort().join(",");
            const newFilenames = audioFiles.map((f: string) => extractFilename(f)).sort().join(",");
            if (newFilenames !== currentFilenames) {
              await scanFolder(activeUri, isPlayingRef.current);
            }
          } catch {}
        }
        if (normalizationPendingRef.current && !isNormalizingRef.current) {
          setTimeout(() => { normalizeGainsRef.current?.(); }, 1500);
        }
        if (trackGainsRef.current.size > 0) {
          const curTk = tracksRef.current.find(t => t.id === currentTrackIdRef.current);
          if (curTk) {
            const gain = trackGainsRef.current.get(curTk.uri) ?? 0;
            setTimeout(() => { VolumeAnalyzer.applyGain(gain).catch(() => {}); }, 1500);
          }
        }
        if (stopEndTimeRef.current !== null) {
          const remaining = Math.max(0, Math.ceil((stopEndTimeRef.current - Date.now()) / 1000));
          setStopCountdown(remaining);
          if (remaining <= 0) {
            if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
            stopEndTimeRef.current = null;
            await NasoSanPlayer.shutdown().catch(() => {});
            BackHandler.exitApp();
          }
        } else {
          setStopCountdown(null);
        }
      }
    });
    return () => sub.remove();
  }, [saveCurrentPosition, saveFolderData, scanFolder]);

  const normalizeGains = useCallback(async () => {
    if (!VolumeAnalyzer.isSupported || isNormalizing) return;
    const uri = folderUriRef.current;
    const tks = tracksRef.current;
    if (!uri || tks.length === 0) return;
    cancelNormRef.current = false;
    setNormalizationPending(false);
    setIsNormalizing(true);
    setNormalizingProgress({ current: 0, total: tks.length });
    try {
      let rmsStored: Record<string, number> = {};
      try {
        const rmsRaw = await AsyncStorage.getItem(STORAGE_KEY_RMS(uri));
        if (rmsRaw) rmsStored = JSON.parse(rmsRaw);
      } catch {}
      const rmsValues: Record<string, number> = { ...rmsStored };
      for (let i = 0; i < tks.length; i++) {
        if (cancelNormRef.current) break;
        const t = tks[i];
        setNormalizingProgress({ current: i + 1, total: tks.length });
        await new Promise(r => setTimeout(r, 0));
        if (rmsValues[t.filename] !== undefined) continue;
        const rms = await VolumeAnalyzer.analyzeRMS(t.uri).catch(() => -40 as number);
        rmsValues[t.filename] = rms;
        await AsyncStorage.setItem(STORAGE_KEY_RMS(uri), JSON.stringify(rmsValues)).catch(() => {});
      }
      if (!cancelNormRef.current) {
        const rmsArr = tks.map(t => rmsValues[t.filename] ?? -40);
        const maxRms = Math.max(...rmsArr);
        const gainsMap = new Map<string, number>();
        tks.forEach((t, i) => { gainsMap.set(t.uri, Math.max(0, maxRms - rmsArr[i])); });
        trackGainsRef.current = gainsMap;
        setNormalizationActive(true);
        const gainsObj: Record<string, number> = {};
        gainsMap.forEach((v, k) => { gainsObj[k] = v; });
        await AsyncStorage.setItem(STORAGE_KEY_GAINS(uri), JSON.stringify(gainsObj));
        writeFolderFile(uri, {
          tracks: tracksRef.current,
          shuffleOrder: shuffleOrderRef.current,
          currentTrackId: currentTrackIdRef.current,
          trackEdits: trackEditsRef.current,
          gains: gainsObj,
          shuffleMode: shuffleModeRef.current,
          favoritesMode: favoritesModeRef.current,
        }).catch(() => {});
        const curTk = tracksRef.current.find(t => t.id === currentTrackIdRef.current);
        if (curTk) {
          const gain = gainsMap.get(curTk.uri) ?? 0;
          await VolumeAnalyzer.applyGain(gain);
        }
      }
    } finally {
      setIsNormalizing(false);
      setNormalizingProgress(null);
      if (cancelNormRef.current) {
        const missing = trackGainsRef.current.size === 0 ||
          tracksRef.current.some(t => !trackGainsRef.current.has(t.uri));
        if (missing) setNormalizationPending(true);
      }
    }
  }, [isNormalizing]);

  useEffect(() => { normalizeGainsRef.current = normalizeGains; }, [normalizeGains]);

  const clearNormalization = useCallback(async () => {
    trackGainsRef.current = new Map();
    setNormalizationActive(false);
    setNormalizationPending(false);
    await VolumeAnalyzer.applyGain(0).catch(() => {});
  }, []);

  const resetNormalization = useCallback(async () => {
    cancelNormRef.current = true;
    VolumeAnalyzer.cancelAnalysis();
    const uri = folderUriRef.current;
    trackGainsRef.current = new Map();
    setNormalizationActive(false);
    setNormalizationPending(false);
    setNormalizingProgress(null);
    await VolumeAnalyzer.applyGain(0).catch(() => {});
    if (uri) {
      await AsyncStorage.removeItem(STORAGE_KEY_GAINS(uri)).catch(() => {});
      await AsyncStorage.removeItem(STORAGE_KEY_RMS(uri)).catch(() => {});
      const folderFile = await readFolderFile(uri).catch(() => null);
      if (folderFile) {
        writeFolderFile(uri, { ...folderFile, gains: undefined }).catch(() => {});
      }
    }
  }, []);

  const cancelNormalization = useCallback(() => {
    cancelNormRef.current = true;
    VolumeAnalyzer.cancelAnalysis();
  }, []);

  const resetCassetteData = useCallback(async () => {
    const uri = folderUriRef.current;
    if (!uri) return;
    const fileUri = await findFolderDataUri(uri).catch(() => null);
    if (fileUri) {
      await (FileSystem as any).deleteAsync(fileUri, { idempotent: true }).catch(() => {});
    }
    await AsyncStorage.multiRemove([
      STORAGE_KEY_DATA(uri),
      STORAGE_KEY_GAINS(uri),
      STORAGE_KEY_RMS(uri),
    ]).catch(() => {});
    trackEditsRef.current = {};
    setTrackEdits({});
    trackGainsRef.current = new Map();
    setNormalizationActive(false);
    setNormalizationPending(false);
    normalizationPendingRef.current = false;
    setNormalizingProgress(null);
    await scanFolder(uri);
  }, [scanFolder]);

  useEffect(() => {
    if (!folderUri) {
      trackGainsRef.current = new Map();
      setNormalizationActive(false);
      setNormalizingProgress(null);
      return;
    }
    (async () => {
      try {
        let gainsObj: Record<string, number> | null = null;
        const folderFile = await readFolderFile(folderUri).catch(() => null);
        if (folderFile?.gains && Object.keys(folderFile.gains).length > 0) {
          gainsObj = folderFile.gains;
        } else {
          const rawGains = await AsyncStorage.getItem(STORAGE_KEY_GAINS(folderUri));
          if (rawGains) gainsObj = JSON.parse(rawGains) as Record<string, number>;
        }
        if (gainsObj) {
          trackGainsRef.current = new Map(Object.entries(gainsObj));
          setNormalizationActive(true);
          setTimeout(() => {
            const curTk = tracksRef.current.find(t => t.id === currentTrackIdRef.current);
            if (curTk) {
              const gain = trackGainsRef.current.get(curTk.uri) ?? 0;
              VolumeAnalyzer.applyGain(gain).catch(() => {});
            }
          }, 2000);
        } else {
          trackGainsRef.current = new Map();
          setNormalizationActive(false);
        }
      } catch {}
    })();
  }, [folderUri]);

  // ── Folder management ─────────────────────────────────────────────────────────
  const pickFolder = useCallback(async () => {
    try {
      const perms = await SAF.requestDirectoryPermissionsAsync();
      if (!perms.granted) return;
      const uri = perms.directoryUri;
      const name = getFolderName(uri);

      await NasoSanPlayer.reset();

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
    await NasoSanPlayer.reset().catch(() => {});

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

  // ── Playback controls ─────────────────────────────────────────────────────────
  const play = useCallback(async () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    stopEndTimeRef.current = null;
    setStopCountdown(null);

    await ensureRtpSetup();

    const tks = tracksRef.current;
    if (!tks.length) return;

    const curId = currentTrackIdRef.current;
    const active = getActiveList(tks, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
    if (!active.length) return;

    if (isPausedRef.current) {
      await NasoSanPlayer.play();
      return;
    }

    const queue = await NasoSanPlayer.getQueue();
    if (queue.length === 0) {
      await syncQueueToActiveList(active, curId, true);
    } else {
      await NasoSanPlayer.play();
    }
  }, [getActiveList, syncQueueToActiveList]);

  const pause = useCallback(async () => {
    await saveCurrentPosition();
    await NasoSanPlayer.pause();
  }, [saveCurrentPosition]);

  const stop = useCallback(async () => {
    if (stopEndTimeRef.current !== null) {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
      stopEndTimeRef.current = null;
      await NasoSanPlayer.shutdown().catch(() => {});
      BackHandler.exitApp();
      return;
    }
    await saveCurrentPosition();
    await NasoSanPlayer.pause();
    const uri = folderUriRef.current;
    if (uri) {
      await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, currentTrackIdRef.current);
    }
    setIsPlaying(false);
    setIsPaused(false);
    const STOP_SECS = 7;
    stopEndTimeRef.current = Date.now() + STOP_SECS * 1000;
    setStopCountdown(STOP_SECS);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(async () => {
      const remaining = Math.max(0, Math.ceil((stopEndTimeRef.current! - Date.now()) / 1000));
      setStopCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        stopEndTimeRef.current = null;
        await NasoSanPlayer.shutdown().catch(() => {});
        BackHandler.exitApp();
      }
    }, 500);
  }, [saveCurrentPosition, saveFolderData]);

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
      try { await NasoSanPlayer.updateMetadataForTrack(idx, { title, artist }); } catch {}
    }
  }, [saveFolderData, getActiveList]);

  const cancelStop = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    stopEndTimeRef.current = null;
    setStopCountdown(null);
  }, []);

  const pauseForScreen = useCallback(async () => {
    wasPlayingBeforeScreenRef.current = isPlayingRef.current;
    if (isPlayingRef.current) {
      await NasoSanPlayer.pause();
    }
  }, []);

  const resumeAfterScreen = useCallback(async () => {
    if (wasPlayingBeforeScreenRef.current) {
      wasPlayingBeforeScreenRef.current = false;
      await NasoSanPlayer.play();
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
    stopEndTimeRef.current = null;
    setStopCountdown(null);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    await NasoSanPlayer.skip(nextIdx);
    if (savedMs > 0) await NasoSanPlayer.seekTo(savedMs / 1000);
    await NasoSanPlayer.play();
  }, [getActiveList, saveCurrentPosition, saveFolderData]);

  const prev = useCallback(async () => {
    const tks = tracksRef.current;
    const curId = currentTrackIdRef.current;
    const active = getActiveList(tks, shuffleModeRef.current, favoritesModeRef.current, shuffleOrderRef.current);
    if (!active.length) return;

    let currentPos = 0;
    try { currentPos = await NasoSanPlayer.getPosition(); } catch {}
    if (currentPos > 3) {
      await NasoSanPlayer.seekTo(0);
      await NasoSanPlayer.play();
      const id = curId;
      if (id != null) {
        setTracks(prev => {
          const updated = prev.map(t => t.id === id ? { ...t, positionMs: 0 } : t);
          tracksRef.current = updated;
          return updated;
        });
      }
      return;
    }

    await saveCurrentPosition();
    const uri = folderUriRef.current;
    if (uri) await saveFolderData(uri, tracksRef.current, shuffleOrderRef.current, curId);

    const idx = active.findIndex(t => t.id === curId);
    const prevIdx = idx <= 0 ? active.length - 1 : idx - 1;
    const prevTrack = tracksRef.current.find(t => t.id === active[prevIdx].id) ?? active[prevIdx];
    const savedMs = prevTrack.positionMs ?? 0;

    setCurrentTrackId(active[prevIdx].id);
    currentTrackIdRef.current = active[prevIdx].id;
    stopEndTimeRef.current = null;
    setStopCountdown(null);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    await NasoSanPlayer.skip(prevIdx);
    if (savedMs > 0) await NasoSanPlayer.seekTo(savedMs / 1000);
    await NasoSanPlayer.play();
  }, [getActiveList, saveCurrentPosition, saveFolderData]);

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
    stopEndTimeRef.current = null;
    setStopCountdown(null);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }

    await NasoSanPlayer.skip(idx);
    if (savedMs > 0) await NasoSanPlayer.seekTo(savedMs / 1000);
    if (shouldPlay) await NasoSanPlayer.play();
  }, [getActiveList, saveCurrentPosition]);

  // ── FF / RW ───────────────────────────────────────────────────────────────────
  const startFF = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    stopEndTimeRef.current = null;
    setStopCountdown(null);
    setIsFF(true);
    ffSpeedRef.current = 2;
    if (ffIntervalRef.current) clearInterval(ffIntervalRef.current);
    ffIntervalRef.current = setInterval(async () => {
      const pos = playbackPositionMsRef.current / 1000;
      const dur = await NasoSanPlayer.getDuration();
      if (!isFinite(dur) || dur <= 0) return;
      const newPos = Math.min(pos + ffSpeedRef.current, dur);
      await NasoSanPlayer.seekTo(newPos);
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
      const pos = playbackPositionMsRef.current / 1000;
      const newPos = Math.max(pos - rwSpeedRef.current, 0);
      await NasoSanPlayer.seekTo(newPos);
      rwSpeedRef.current = Math.min(rwSpeedRef.current + 0.5, 10);
    }, 300);
  }, []);

  const stopRW = useCallback(() => {
    setIsRW(false);
    if (rwIntervalRef.current) { clearInterval(rwIntervalRef.current); rwIntervalRef.current = null; }
    rwSpeedRef.current = 2;
  }, []);

  // ── Shuffle / Favorites ───────────────────────────────────────────────────────
  const shuffleFromCurrent = useCallback((ids: number[]): number[] => {
    const curId = currentTrackIdRef.current;
    const rest = ids.filter(id => id !== curId);
    const shuffled = shuffleArray(rest);
    return curId != null ? [curId, ...shuffled] : shuffled;
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffleMode(prev => {
      const next = !prev;
      shuffleModeRef.current = next;

      let order = shuffleOrderRef.current;
      if (next) {
        const ids = tracksRef.current.map(t => t.id);
        order = shuffleFromCurrent(ids);
        setShuffleOrder(order);
        shuffleOrderRef.current = order;
      }

      const newActive = getActiveList(tracksRef.current, next, favoritesModeRef.current, order);
      syncQueueToActiveList(newActive, currentTrackIdRef.current, isPlayingRef.current);
      saveSettings();
      return next;
    });
  }, [getActiveList, syncQueueToActiveList, saveSettings, shuffleFromCurrent]);

  const regenerateShuffle = useCallback(() => {
    const ids = tracksRef.current.map(t => t.id);
    const newOrder = shuffleFromCurrent(ids);
    setShuffleOrder(newOrder);
    shuffleOrderRef.current = newOrder;
    setShuffleMode(true);
    shuffleModeRef.current = true;

    const newActive = getActiveList(tracksRef.current, true, favoritesModeRef.current, newOrder);
    syncQueueToActiveList(newActive, currentTrackIdRef.current, isPlayingRef.current);
    saveSettings();
  }, [getActiveList, syncQueueToActiveList, saveSettings, shuffleFromCurrent]);

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

      let targetId: number | null;
      if (next) {
        preFilterTrackIdRef.current = currentTrackIdRef.current;
        targetId = currentTrackIdRef.current;
      } else {
        targetId = preFilterTrackIdRef.current ?? currentTrackIdRef.current;
        preFilterTrackIdRef.current = null;
      }

      const newActive = getActiveList(tks, shuffleModeRef.current, next, shuffleOrderRef.current);
      syncQueueToActiveList(newActive, targetId, isPlayingRef.current);
      saveSettings();
      return next;
    });
  }, [favoritesMode, getActiveList, syncQueueToActiveList, saveSettings]);

  const toggleFavorite = useCallback((trackId: number) => {
    setTracks(prev => {
      const updated = prev.map(t => t.id === trackId ? { ...t, favorite: !t.favorite } : t);
      tracksRef.current = updated;
      const uri = folderUriRef.current;
      if (uri) saveFolderData(uri, updated, shuffleOrderRef.current, currentTrackIdRef.current).catch(() => {});
      return updated;
    });
  }, [saveFolderData]);

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
      normalizeGains,
      isNormalizing,
      normalizationActive,
      normalizationPending,
      normalizingProgress,
      clearNormalization,
      resetNormalization,
      cancelNormalization,
      resetCassetteData,
      cancelStop,
      pauseForScreen,
      resumeAfterScreen,
    }}>
      {children}
    </PlayerContext.Provider>
  );
}
