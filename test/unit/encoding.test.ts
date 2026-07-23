import { describe, expect, it } from 'vitest';
import {
  codepageToLabel,
  decodeBytes,
  decodeUtf16le,
  filetimeToDate,
} from '../../src/encoding/index.js';

describe('codepageToLabel', () => {
  it('maps common codepages', () => {
    expect(codepageToLabel(65001)).toBe('utf-8');
    expect(codepageToLabel(20127)).toBe('ascii');
    expect(codepageToLabel(1251)).toBe('windows-1251');
    expect(codepageToLabel(932)).toBe('shift_jis');
    expect(codepageToLabel(28592)).toBe('iso-8859-2');
  });
  it('returns null for unknown/empty', () => {
    expect(codepageToLabel(0)).toBeNull();
    expect(codepageToLabel(null)).toBeNull();
    expect(codepageToLabel(999999)).toBeNull();
  });
});

describe('decodeBytes', () => {
  it('decodes windows-1252 by default', () => {
    expect(decodeBytes(new Uint8Array([72, 105]))).toBe('Hi');
  });
  it('falls back to windows-1252 on invalid label', () => {
    expect(decodeBytes(new Uint8Array([65]), 'not-a-real-charset')).toBe('A');
  });
});

describe('decodeUtf16le', () => {
  it('decodes UTF-16LE and trims trailing NULs', () => {
    // "Hi" in UTF-16LE with a trailing NUL
    const bytes = new Uint8Array([0x48, 0x00, 0x69, 0x00, 0x00, 0x00]);
    expect(decodeUtf16le(bytes)).toBe('Hi');
  });
});

describe('filetimeToDate', () => {
  it('converts FILETIME to the correct UTC date', () => {
    // 2020-01-01T00:00:00Z == 132223104000000000 100ns ticks since 1601.
    const ticks = 132223104000000000;
    const lo = ticks % 4294967296;
    const hi = Math.floor(ticks / 4294967296);
    const d = filetimeToDate(lo, hi);
    expect(d.toISOString()).toBe('2020-01-01T00:00:00.000Z');
  });
});
