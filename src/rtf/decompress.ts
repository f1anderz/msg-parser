const MAX_RTF_OUTPUT = 100 * 1024 * 1024;

const LZFU_PREFILL =
  '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss ' +
  '\\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier' +
  '{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';

/** Decompress a compressed-RTF stream (LZFu), or pass through MELA. Null on bad input. */
export function decompressRtf(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 16) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const compSize = dv.getUint32(0, true);
  const rawSize = dv.getUint32(4, true);
  const magic = dv.getUint32(8, true);
  if (magic !== 0x414c454d && magic !== 0x75465a4c) return null; // not "MELA" nor "LZFu"
  if (rawSize > MAX_RTF_OUTPUT) return null;
  if (magic === 0x414c454d) return bytes.slice(16, 16 + rawSize); // "MELA" — uncompressed
  const dict = new Uint8Array(4096);
  for (let i = 0; i < LZFU_PREFILL.length; i++) dict[i] = LZFU_PREFILL.charCodeAt(i) & 0xff;
  let wp = LZFU_PREFILL.length;
  const out = new Uint8Array(rawSize);
  let op = 0;
  let pos = 16;
  const end = Math.min(bytes.length, compSize + 4);
  while (pos < end && op < rawSize) {
    const control = bytes[pos++]!;
    for (let bit = 0; bit < 8 && pos < end && op < rawSize; bit++) {
      if (control & (1 << bit)) {
        if (pos + 1 >= end + 1) break;
        const b1 = bytes[pos++]!;
        const b2 = bytes[pos++]!;
        let offset = (b1 << 4) | (b2 >> 4);
        const len = (b2 & 0x0f) + 2;
        if (offset === wp) {
          pos = end;
          break;
        }
        for (let k = 0; k < len && op < rawSize; k++) {
          const ch = dict[offset]!;
          offset = (offset + 1) & 4095;
          dict[wp] = ch;
          wp = (wp + 1) & 4095;
          out[op++] = ch;
        }
      } else {
        const c = bytes[pos++]!;
        dict[wp] = c;
        wp = (wp + 1) & 4095;
        out[op++] = c;
      }
    }
  }
  return out.subarray(0, op);
}
