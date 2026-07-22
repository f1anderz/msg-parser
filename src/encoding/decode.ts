/** Decode bytes with the given TextDecoder label, falling back to windows-1252. */
export function decodeBytes(bytes: Uint8Array, label?: string | null): string {
  try {
    return new TextDecoder(label || 'windows-1252').decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Decode UTF-16LE bytes and strip trailing NUL padding. */
export function decodeUtf16le(bytes: Uint8Array): string {
  return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
}

/** Convert a Win32 FILETIME (100ns ticks since 1601-01-01) to a JS Date. */
export function filetimeToDate(lo: number, hi: number): Date {
  const ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
  return new Date(ms);
}
