import { useEffect, useState } from "react";
import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const CarModeModule = NativeModules.CarModeModule as {
  startListening: () => void;
  stopListening: () => void;
  isInCarMode: () => Promise<boolean>;
} | undefined;

const TAG = "NasoSanCarMode";

export function useCarMode(): boolean {
  const [isCarMode, setIsCarMode] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android" || !CarModeModule) return;

    let active = true;

    async function enterCar() {
      if (!active) return;
      setIsCarMode(true);
      try {
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.LANDSCAPE
        );
        await activateKeepAwakeAsync(TAG);
      } catch {}
    }

    async function exitCar() {
      if (!active) return;
      setIsCarMode(false);
      try {
        await ScreenOrientation.unlockAsync();
        deactivateKeepAwake(TAG);
      } catch {}
    }

    // Controlla stato iniziale (app aperta mentre già connessa)
    CarModeModule.isInCarMode().then((inCar) => {
      if (inCar) enterCar();
    });
    // Retry multipli: il modulo nativo dopo un crash può impiegare fino a 5s per inizializzarsi
    const retryTimers: ReturnType<typeof setTimeout>[] = [];
    [1000, 2000, 5000].forEach(delay => {
      retryTimers.push(setTimeout(() => {
        if (!active) return;
        CarModeModule?.isInCarMode().then((inCar) => {
          if (inCar && active) enterCar();
        }).catch(() => {});
      }, delay));
    });

    CarModeModule.startListening();

    const enterSub = DeviceEventEmitter.addListener(
      "nasosan_car_enter",
      enterCar
    );
    const exitSub = DeviceEventEmitter.addListener(
      "nasosan_car_exit",
      exitCar
    );

    return () => {
      active = false;
      retryTimers.forEach(t => clearTimeout(t));
      CarModeModule?.stopListening();
      enterSub.remove();
      exitSub.remove();
      ScreenOrientation.unlockAsync().catch(() => {});
      try { deactivateKeepAwake(TAG); } catch {}
    };
  }, []);

  return isCarMode;
}
