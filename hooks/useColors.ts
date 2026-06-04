import { useColorScheme } from "react-native";

import colors from "@/constants/colors";

// Predisposto per dark theme: aggiungere chiave `dark` in colors.ts attiva lo switch automatico.
// I componenti usano C direttamente con StyleSheet.create (valori statici obbligatori);
// per dark mode completo dovranno migrare a stili inline tramite questo hook.
export function useColors() {
  const scheme = useColorScheme();
  const palette =
    scheme === "dark" && "dark" in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}
