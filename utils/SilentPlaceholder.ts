import * as FileSystem from "expo-file-system/legacy";

const SILENT_VER = "ns_sil_v1";
let _uri: string | null = null;

function buildSilentWav(durationSec: number, sampleRate = 8000): string {
  const numSamples = sampleRate * durationSec;
  const dataLen = numSamples * 2;
  const buf = new Uint8Array(44 + dataLen);
  const v = new DataView(buf.buffer);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + dataLen, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); ws(36, "data"); v.setUint32(40, dataLen, true);
  const chars: string[] = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) chars[i] = String.fromCharCode(buf[i]);
  return btoa(chars.join(""));
}

export async function getSilentPlaceholderUri(): Promise<string> {
  if (_uri) return _uri;
  const dir = `${FileSystem.cacheDirectory}${SILENT_VER}/`;
  const filePath = `${dir}silence.wav`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  let info: { exists: boolean } = { exists: false };
  try { info = await FileSystem.getInfoAsync(filePath); } catch {}
  if (info.exists) { _uri = filePath; return filePath; }
  const b64 = buildSilentWav(30);
  await FileSystem.writeAsStringAsync(filePath, b64, { encoding: FileSystem.EncodingType.Base64 });
  _uri = filePath;
  return filePath;
}
