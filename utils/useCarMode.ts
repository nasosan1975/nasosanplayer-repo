import { useEffect, useState } from "react";
import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

const CarModeModule = NativeModules.CarModeModule as {
  startListening: () => void;
  stopListening: () => void;
  isInCarMode: () => Promise<boolean>;
} | undefined;

export function useCarMode(): boolean {
  const [isCarMode, setIsCarMode] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android" || !CarModeModule) return;

    let active = true;
    let inCar = false;

    function enterCar() {
      if (!active || inCar) return;
      inCar = true;
      setIsCarMode(true);
    }

    function exitCar() {
      if (!active) return;
      inCar = false;
      setIsCarMode(false);
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
    };
  }, []);

  return isCarMode;
}
