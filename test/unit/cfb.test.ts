import { describe, expect, it } from 'vitest';
import { Cfb } from '../../src/cfb/index.js';
import { InvalidMsgError } from '../../src/types.js';
import { buildCfb } from '../helpers/build-cfb.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('Cfb', () => {
  it('rejects a non-OLE buffer', () => {
    const bad = new Uint8Array(600).buffer;
    expect(() => new Cfb(bad)).toThrow(InvalidMsgError);
  });

  it('reads a single stream', () => {
    const buf = buildCfb({ streams: [{ name: 'hello', data: enc('world') }] });
    const cfb = new Cfb(buf);
    const kids = cfb.children(0);
    const hello = kids.find((k) => k.entry.name === 'hello');
    expect(hello).toBeDefined();
    expect(new TextDecoder().decode(cfb.readStream(hello!.entry))).toBe('world');
  });

  it('reads a multi-sector stream (>512 bytes)', () => {
    const big = enc('A'.repeat(1500));
    const buf = buildCfb({ streams: [{ name: 'big', data: big }] });
    const cfb = new Cfb(buf);
    const entry = cfb.children(0).find((k) => k.entry.name === 'big')!.entry;
    expect(cfb.readStream(entry).length).toBe(1500);
    expect(new TextDecoder().decode(cfb.readStream(entry))).toBe('A'.repeat(1500));
  });

  it('navigates nested storages', () => {
    const buf = buildCfb({
      storages: [{ name: 'sub', streams: [{ name: 'inner', data: enc('x') }] }],
    });
    const cfb = new Cfb(buf);
    const sub = cfb.children(0).find((k) => k.entry.name === 'sub')!;
    const inner = cfb.children(sub.index).find((k) => k.entry.name === 'inner')!;
    expect(new TextDecoder().decode(cfb.readStream(inner.entry))).toBe('x');
  });
});
