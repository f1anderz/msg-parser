import { describe, expect, it } from 'vitest';
import { decompressRtf } from '../../src/rtf/decompress.js';

function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

describe('decompressRtf', () => {
  it('returns null for junk / too-short input', () => {
    expect(decompressRtf(new Uint8Array(4))).toBeNull();
    const junk = new Uint8Array([...u32le(0), ...u32le(0), ...u32le(0x11111111), ...u32le(0)]);
    expect(decompressRtf(junk)).toBeNull();
  });

  it('passes through MELA (uncompressed) payload', () => {
    const payload = new TextEncoder().encode('{\\rtf1 hello}');
    const bytes = new Uint8Array([
      ...u32le(payload.length + 12),
      ...u32le(payload.length),
      ...u32le(0x414c454d), // "MELA"
      ...u32le(0),
      ...payload,
    ]);
    const out = decompressRtf(bytes);
    expect(out).not.toBeNull();
    expect(new TextDecoder().decode(out!)).toBe('{\\rtf1 hello}');
  });

  it('rejects an implausibly large rawSize instead of allocating it (avoids huge allocation)', () => {
    const rawSize = 0x7fffffff;
    const bytes = new Uint8Array([
      ...u32le(16),
      ...u32le(rawSize),
      ...u32le(0x75465a4c), // "LZFu"
      ...u32le(0),
    ]);
    expect(decompressRtf(bytes)).toBeNull();
  });

  it('decompresses an LZFu stream of pure literals', () => {
    // control byte 0x00 => next 8 bytes are literals
    const literals = [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48]; // ABCDEFGH
    const comp = [0x00, ...literals];
    const rawSize = literals.length;
    const bytes = new Uint8Array([
      ...u32le(comp.length + 12),
      ...u32le(rawSize),
      ...u32le(0x75465a4c), // "LZFu"
      ...u32le(0),
      ...comp,
    ]);
    const out = decompressRtf(bytes);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(literals);
  });
});
