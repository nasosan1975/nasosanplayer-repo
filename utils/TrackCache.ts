// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

import { NativeModules, Platform } from "react-native";

const { TrackCache: Native } = NativeModules;

export function updateAutoState(
  title: string,
  artist: string,
  queue: { title: string; artist: string }[]
): void {
  if (Platform.OS !== "android" || !Native) return;
  try {
    Native.update(
      title || "",
      artist || "",
      JSON.stringify(queue.map(t => ({ title: t.title || "", artist: t.artist || "" })))
    );
  } catch {}
}
