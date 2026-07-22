import { describe, expect, it } from 'vitest';
import { Cfb } from '../../src/cfb/index.js';
import {
  readSubStorageProps,
  parseFixedProps,
  makeGetter,
  detectCodepage,
  type RawProp,
} from '../../src/mapi/index.js';
import { buildCfb } from '../helpers/build-cfb.js';

// Encode a MAPI substream name for property id 0037 (subject), type 001F (unicode).
const utf16 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
};

describe('readSubStorageProps + makeGetter', () => {
  it('reads a unicode string substream property', () => {
    const buf = buildCfb({
      streams: [{ name: '__substg1.0_0037001F', data: utf16('Hello subject') }],
    });
    const cfb = new Cfb(buf);
    const { props } = readSubStorageProps(cfb, 0);
    const get = makeGetter(props, null);
    expect(get('0037')).toBe('Hello subject');
  });

  it('collects recipient/attachment substorages', () => {
    const buf = buildCfb({
      storages: [{ name: '__recip_version1.0_#00000000' }, { name: '__attach_version1.0_#00000000' }],
    });
    const cfb = new Cfb(buf);
    const { subStorages } = readSubStorageProps(cfb, 0);
    const names = subStorages.map((s) => s.name).sort();
    expect(names).toEqual(['__attach_version1.0_#00000000', '__recip_version1.0_#00000000']);
  });
});

describe('parseFixedProps', () => {
  it('reads a boolean fixed property (000B)', () => {
    // header (8 bytes) + one 16-byte record: type 000B, id 7FFE, value 1
    const rec = new Uint8Array(8 + 16);
    const dv = new DataView(rec.buffer);
    dv.setUint16(8, 0x000b, true); // type
    dv.setUint16(10, 0x7ffe, true); // id
    dv.setUint8(16, 1); // value
    const props: Record<string, RawProp> = {};
    parseFixedProps(rec, 8, props);
    expect(props['7FFE']!.value).toBe(true);
  });
});

describe('detectCodepage', () => {
  it('maps message codepage 3FFD', () => {
    const props: Record<string, RawProp> = { '3FFD': { type: '0003', value: 65001 } };
    expect(detectCodepage(props)).toBe('utf-8');
  });
});
