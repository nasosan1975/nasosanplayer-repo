const MAX_READ_BYTES = 262144;

function decodeString(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const encoding = bytes[0];
  const content = bytes.subarray(1);

  try {
    if (encoding === 0) {
      const end = content.indexOf(0);
      const slice = end >= 0 ? content.subarray(0, end) : content;
      return Array.from(slice)
        .map((b) => String.fromCharCode(b))
        .join("")
        .trim();
    } else if (encoding === 1 || encoding === 2) {
      let start = 0;
      let le = true;
      if (
        content.length >= 2 &&
        content[0] === 0xff &&
        content[1] === 0xfe
      ) {
        start = 2;
        le = true;
      } else if (
        content.length >= 2 &&
        content[0] === 0xfe &&
        content[1] === 0xff
      ) {
        start = 2;
        le = false;
      } else {
        le = encoding === 1;
      }
      const chars: string[] = [];
      for (let i = start; i < content.length - 1; i += 2) {
        const code = le
          ? content[i] | (content[i + 1] << 8)
          : (content[i] << 8) | content[i + 1];
        if (code === 0) break;
        chars.push(String.fromCharCode(code));
      }
      return chars.join("").trim();
    } else if (encoding === 3) {
      const end = content.indexOf(0);
      const slice = end >= 0 ? content.subarray(0, end) : content;
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(slice).trim();
    }
  } catch {}

  return "";
}

function parseID3(data: Uint8Array): { title: string; artist: string } {
  if (
    data.length < 10 ||
    data[0] !== 0x49 ||
    data[1] !== 0x44 ||
    data[2] !== 0x33
  ) {
    return { title: "", artist: "" };
  }

  const version = data[3];
  const tagSize =
    ((data[6] & 0x7f) << 21) |
    ((data[7] & 0x7f) << 14) |
    ((data[8] & 0x7f) << 7) |
    (data[9] & 0x7f);

  const end = Math.min(10 + tagSize, data.length);
  let offset = 10;

  if (data[5] & 0x40) {
    if (version >= 4) {
      const extSize =
        ((data[10] & 0x7f) << 21) |
        ((data[11] & 0x7f) << 14) |
        ((data[12] & 0x7f) << 7) |
        (data[13] & 0x7f);
      offset += extSize;
    } else {
      const extSize =
        (data[10] << 24) | (data[11] << 16) | (data[12] << 8) | data[13];
      offset += 4 + extSize;
    }
  }

  let title = "";
  let artist = "";

  while (offset < end - 6) {
    if (version === 2) {
      const fid = String.fromCharCode(
        data[offset],
        data[offset + 1],
        data[offset + 2]
      );
      const fsize =
        (data[offset + 3] << 16) |
        (data[offset + 4] << 8) |
        data[offset + 5];
      if (!fid.trim() || fsize <= 0 || offset + 6 + fsize > end) break;
      const fdata = data.subarray(offset + 6, offset + 6 + fsize);
      if (fid === "TT2") title = decodeString(fdata);
      if (fid === "TP1") artist = decodeString(fdata);
      offset += 6 + fsize;
    } else {
      if (offset + 10 > end) break;
      const fid = String.fromCharCode(
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3]
      );
      if (data[offset] === 0) break;
      let fsize: number;
      if (version >= 4) {
        fsize =
          ((data[offset + 4] & 0x7f) << 21) |
          ((data[offset + 5] & 0x7f) << 14) |
          ((data[offset + 6] & 0x7f) << 7) |
          (data[offset + 7] & 0x7f);
      } else {
        fsize =
          (data[offset + 4] << 24) |
          (data[offset + 5] << 16) |
          (data[offset + 6] << 8) |
          data[offset + 7];
      }
      if (fsize <= 0 || offset + 10 + fsize > end) break;
      const fdata = data.subarray(offset + 10, offset + 10 + fsize);
      if (fid === "TIT2") title = decodeString(fdata);
      if (fid === "TPE1") artist = decodeString(fdata);
      offset += 10 + fsize;
    }
    if (title && artist) break;
  }

  return { title, artist };
}

export async function readID3Tags(
  uri: string
): Promise<{ title: string; artist: string }> {
  try {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) return { title: "", artist: "" };

    const chunks: Uint8Array[] = [];
    let received = 0;

    try {
      while (received < MAX_READ_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        received += value.byteLength;
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    const data = new Uint8Array(received);
    let off = 0;
    for (const chunk of chunks) {
      data.set(chunk, off);
      off += chunk.byteLength;
    }

    return parseID3(data);
  } catch {
    return { title: "", artist: "" };
  }
}
