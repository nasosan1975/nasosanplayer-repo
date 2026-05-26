import { NativeModules } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

const { WmaPlayer } = NativeModules;

const CACHE_VER = "ns_wma_v5";
let cacheDir: string | null = null;

async function ensureCacheDir(): Promise<string> {
  if (cacheDir) return cacheDir;
  const dir = `${FileSystem.cacheDirectory}${CACHE_VER}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  cacheDir = dir;
  return dir;
}

function uriHash(uri: string): string {
  let h = 0;
  for (let i = 0; i < uri.length; i++) h = (Math.imul(h, 31) + uri.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function isWma(uri: string): boolean {
  return /\.wma$/i.test(decodeURIComponent(uri));
}

const inflight: Map<string, Promise<string>> = new Map();

/**
 * Converte un file WMA in WAV usando il modulo nativo Kotlin (MediaCodec).
 * Il modulo copia prima il file in un path locale, poi usa MediaExtractor
 * + MediaCodec con il MIME type grezzo del dispositivo (no normalizzazione).
 * Restituisce un URI file:// compatibile con ExoPlayer/RNTP.
 */
export async function convertWma(uri: string): Promise<string> {
  if (!WmaPlayer) {
    throw new Error("WmaPlayer non disponibile — necessario APK con modulo nativo");
  }

  const hash = uriHash(uri);
  const existing = inflight.get(hash);
  if (existing) return existing;

  const p = (async (): Promise<string> => {
    const dir = await ensureCacheDir();
    const wavPath = dir.replace(/^file:\/\//, "") + hash + ".wav";

    const info = await FileSystem.getInfoAsync("file://" + wavPath);
    if (info.exists && ((info as { size?: number }).size ?? 0) > 44) {
      return "file://" + wavPath;
    }

    await (WmaPlayer.convertToWav(uri, wavPath) as Promise<string>);
    return "file://" + wavPath;
  })();

  inflight.set(hash, p);
  p.finally(() => inflight.delete(hash));
  return p;
}

export function preConvertWmaFiles(uris: string[]): void {
  uris.filter(isWma).forEach(uri => convertWma(uri).catch(() => {}));
}
