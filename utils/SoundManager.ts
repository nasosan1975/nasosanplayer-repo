import { Platform } from "react-native";

const SR = 22050;

export type SoundName = "click" | "play" | "stop" | "ff" | "eject" | "insert";

// ─── Web Audio API path ───────────────────────────────────────────────────────

let webCtx: AudioContext | null = null;

function genClick(): number[] {
  const n = Math.floor(SR * 0.015);
  return Array.from({ length: n }, (_, i) => {
    const t = i / SR;
    const env = Math.exp(-t * 600);
    return env * ((Math.random() * 2 - 1) * 0.7 + Math.sin(2 * Math.PI * 2800 * t) * 0.3) * 0.9;
  });
}

function genPlay(): number[] {
  const n = Math.floor(SR * 0.030);
  return Array.from({ length: n }, (_, i) => {
    const t = i / SR;
    const env = Math.exp(-t * 120);
    return env * ((Math.random() * 2 - 1) * 0.25 + Math.sin(2 * Math.PI * 55 * t) * 0.75) * 0.88;
  });
}

function genStop(): number[] {
  const n = Math.floor(SR * 0.040);
  return Array.from({ length: n }, (_, i) => {
    const t = i / SR;
    const env = Math.exp(-t * 90);
    const thud = Math.sin(2 * Math.PI * 40 * t) * 0.8;
    const crack = Math.exp(-t * 500) * Math.sin(2 * Math.PI * 1600 * t) * 0.2;
    return env * (thud + crack) * 0.88;
  });
}

function genFF(): number[] {
  const n = Math.floor(SR * 0.050);
  return Array.from({ length: n }, (_, i) => {
    const t = i / SR;
    const env = Math.min(t / 0.006, 1) * Math.exp(-t * 80);
    return env * ((Math.random() * 2 - 1) * 0.55 + Math.sin(2 * Math.PI * 350 * t) * 0.45) * 0.75;
  });
}

function genEject(): number[] {
  const n = Math.floor(SR * 0.070);
  return Array.from({ length: n }, (_, i) => {
    const t = i / SR;
    const env = Math.exp(-t * 120);
    const spring = Math.sin(2 * Math.PI * (220 - t * 300) * t) * 0.6;
    const click = Math.exp(-t * 800) * (Math.random() * 2 - 1) * 0.4;
    return env * (spring + click) * 0.85;
  });
}

function genInsert(): number[] {
  const n = Math.floor(SR * 0.050);
  return Array.from({ length: n }, (_, i) => {
    const t = i / SR;
    const env = Math.exp(-t * 160);
    const snap = Math.sin(2 * Math.PI * 1200 * t) * 0.55;
    const thud = Math.sin(2 * Math.PI * 60 * t) * 0.45;
    return env * (snap + thud) * 0.88;
  });
}

const generators: Record<SoundName, () => number[]> = {
  click:  genClick,
  play:   genPlay,
  stop:   genStop,
  ff:     genFF,
  eject:  genEject,
  insert: genInsert,
};

function playWebSound(name: SoundName): void {
  try {
    if (!webCtx) webCtx = new AudioContext();
    const samples = generators[name]();
    const buffer = webCtx.createBuffer(1, samples.length, SR);
    buffer.copyToChannel(new Float32Array(samples), 0);
    const src = webCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(webCtx.destination);
    src.start();
  } catch {
    // silently ignore
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function initSounds(): Promise<void> {
  // expo-av conflicts with RNTP on Android — sounds disabled on native
  return;
}

export async function playSound(name: SoundName): Promise<void> {
  if (Platform.OS === "web") {
    playWebSound(name);
  }
  // No-op on native — expo-av + RNTP audio session conflict
}
