import type { Cfb } from '../cfb/index.js';
import { codepageToLabel, decodeBytes, decodeUtf16le, filetimeToDate } from '../encoding/index.js';

export interface RawProp {
  type: string;
  bytes?: Uint8Array;
  value?: unknown;
  storageIndex?: number;
}

export interface StorageProps {
  props: Record<string, RawProp>;
  fixed?: Uint8Array; // raw __properties_version1.0 stream, parsed later by parseFixedProps
  subStorages: { name: string; index: number }[];
}

export function readSubStorageProps(cfb: Cfb, entryIndex: number): StorageProps {
  const props: Record<string, RawProp> = {};
  let fixed: Uint8Array | undefined;
  const subStorages: { name: string; index: number }[] = [];
  const kids = cfb.children(entryIndex);
  for (const k of kids) {
    const name = k.entry.name;
    if (name.indexOf('__substg1.0_') === 0 && k.entry.type === 2) {
      const tag = name.substr(12, 8).toUpperCase();
      const id = tag.substr(0, 4);
      const type = tag.substr(4, 4);
      props[id] = { type, bytes: cfb.readStream(k.entry) };
    } else if (name.indexOf('__substg1.0_') === 0 && k.entry.type === 1) {
      const tag2 = name.substr(12, 8).toUpperCase();
      props[tag2.substr(0, 4)] = { type: tag2.substr(4, 4), storageIndex: k.index };
    } else if (name === '__properties_version1.0') {
      fixed = cfb.readStream(k.entry);
    } else if (k.entry.type === 1) {
      subStorages.push({ name, index: k.index });
    }
  }
  return { props, fixed, subStorages };
}

export function parseFixedProps(
  bytes: Uint8Array | undefined,
  headerSize: number,
  props: Record<string, RawProp>,
): void {
  if (!bytes || bytes.length < headerSize) return;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let off = headerSize; off + 16 <= bytes.length; off += 16) {
    const type = dv.getUint16(off, true);
    const id = dv
      .getUint16(off + 2, true)
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');
    if (props[id]) continue; // substream wins
    let value: unknown;
    switch (type) {
      case 0x0002:
        value = dv.getInt16(off + 8, true);
        break;
      case 0x0003:
        value = dv.getInt32(off + 8, true);
        break;
      case 0x000b:
        value = dv.getUint8(off + 8) !== 0;
        break;
      case 0x0005:
        value = dv.getFloat64(off + 8, true);
        break;
      case 0x0014:
        value = Number(dv.getBigInt64(off + 8, true));
        break;
      case 0x0040:
        value = filetimeToDate(dv.getUint32(off + 8, true), dv.getUint32(off + 12, true));
        break;
      default:
        continue; // variable types store only a size here
    }
    props[id] = { type: type.toString(16).padStart(4, '0').toUpperCase(), value };
  }
}

export function makeGetter(
  props: Record<string, RawProp>,
  cpLabel: string | null,
): (id: string) => string | number | boolean | Date | Uint8Array | null {
  return function get(id: string) {
    const p = props[id];
    if (!p) return null;
    if ('value' in p && p.value !== undefined) return p.value as never;
    if (!p.bytes) return null;
    if (p.type === '001F') return decodeUtf16le(p.bytes);
    if (p.type === '001E') return decodeBytes(p.bytes, cpLabel).replace(/\0+$/, '');
    return p.bytes; // 0102 and others — raw bytes
  };
}

export function detectCodepage(props: Record<string, RawProp>): string | null {
  const p = props['3FFD'];
  let cp = p && 'value' in p ? (p.value as number) : null;
  if (!cp) {
    const q = props['3FDE'];
    cp = q && 'value' in q ? (q.value as number) : null;
    const iso2022: Record<number, number> = {
      50220: 932,
      50221: 932,
      50222: 932,
      50225: 949,
      50227: 936,
      52936: 936,
    };
    if (cp && iso2022[cp]) cp = iso2022[cp]!;
  }
  return codepageToLabel(cp);
}
