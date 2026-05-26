import { NativeModules, NativeEventEmitter, EmitterSubscription } from "react-native";

const { WmaPlayer: Native } = NativeModules;
const emitter = Native ? new NativeEventEmitter(Native) : null;

export type WmaProgressEvent = { position: number; duration: number };
export type WmaLoadedEvent   = { duration: number };

export const WmaPlayer = {
  isSupported: !!Native,

  load(uri: string, positionMs = 0): Promise<number> {
    if (!Native) return Promise.reject("WmaPlayer not available");
    return Native.load(uri, positionMs);
  },

  play(): Promise<void> {
    return Native?.play() ?? Promise.resolve();
  },

  pause(): Promise<void> {
    return Native?.pause() ?? Promise.resolve();
  },

  seekTo(positionMs: number): Promise<void> {
    return Native?.seekTo(positionMs) ?? Promise.resolve();
  },

  getPosition(): Promise<number> {
    return Native?.getPosition() ?? Promise.resolve(0);
  },

  release(): Promise<void> {
    return Native?.release() ?? Promise.resolve();
  },

  onProgress(cb: (e: WmaProgressEvent) => void): EmitterSubscription | null {
    return emitter?.addListener("wma_progress", cb) ?? null;
  },

  onLoaded(cb: (e: WmaLoadedEvent) => void): EmitterSubscription | null {
    return emitter?.addListener("wma_loaded", cb) ?? null;
  },

  onEnded(cb: () => void): EmitterSubscription | null {
    return emitter?.addListener("wma_ended", cb) ?? null;
  },

  onError(cb: (e: { what: number; extra: number }) => void): EmitterSubscription | null {
    return emitter?.addListener("wma_error", cb) ?? null;
  },
};

export function isWma(uri: string): boolean {
  return /\.wma$/i.test(decodeURIComponent(uri));
}
