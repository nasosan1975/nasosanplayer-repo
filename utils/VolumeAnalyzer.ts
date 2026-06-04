// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

import { NativeModules } from "react-native";

const { VolumeAnalyzer: Native } = NativeModules;

export var VolumeAnalyzer = {
  isSupported: !!Native,

  analyzeRMS(uri: string): Promise<number> {
    if (!Native) return Promise.resolve(-40);
    return Native.analyzeRMS(uri);
  },

  cancelAnalysis(): void {
    if (!Native) return;
    Native.cancelAnalysis();
  },

  applyGain(gainDb: number): Promise<void> {
    if (!Native) return Promise.resolve();
    return Native.applyGain(gainDb);
  },
};
