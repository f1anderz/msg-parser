import { InvalidMsgError } from '../types.js';

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

export interface CfbEntry {
  name: string;
  type: number; // 0=unused, 1=storage, 2=stream, 5=root
  left: number;
  right: number;
  child: number;
  startSector: number;
  size: number;
}

export class Cfb {
  private bytes: Uint8Array;
  private dv: DataView;
  private sectorShift!: number;
  private sectorSize!: number;
  private miniSectorSize!: number;
  private firstDirSector!: number;
  private miniStreamCutoff!: number;
  private firstMiniFatSector!: number;
  private firstDifatSector!: number;
  private numDifatSectors!: number;
  private fat!: Uint32Array;
  private miniFat!: Uint32Array;
  private rootChain!: number[];
  entries: CfbEntry[] = [];

  constructor(buf: ArrayBuffer) {
    this.bytes = new Uint8Array(buf);
    this.dv = new DataView(buf);
    this.parseHeader();
    this.readFat();
    this.readDirectory();
    this.readMiniFat();
  }

  private parseHeader(): void {
    const dv = this.dv;
    if (
      this.bytes.length < 512 ||
      dv.getUint32(0, true) !== 0xe011cfd0 ||
      dv.getUint32(4, true) !== 0xe11ab1a1
    ) {
      throw new InvalidMsgError('Not a .msg file (missing OLE Compound File signature)');
    }
    this.sectorShift = dv.getUint16(30, true);
    this.sectorSize = 1 << this.sectorShift;
    this.miniSectorSize = 1 << dv.getUint16(32, true);
    this.firstDirSector = dv.getUint32(48, true);
    this.miniStreamCutoff = dv.getUint32(56, true);
    this.firstMiniFatSector = dv.getUint32(60, true);
    this.firstDifatSector = dv.getUint32(68, true);
    this.numDifatSectors = dv.getUint32(72, true);
  }

  private sectorOffset(sector: number): number {
    return (sector + 1) * this.sectorSize;
  }

  private readFat(): void {
    const dv = this.dv;
    const ss = this.sectorSize;
    const perSector = ss / 4;
    const difat: number[] = [];
    for (let i = 0; i < 109; i++) {
      const v = dv.getUint32(76 + i * 4, true);
      if (v !== FREESECT) difat.push(v);
    }
    let s = this.firstDifatSector;
    let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && guard++ <= this.numDifatSectors) {
      const off = this.sectorOffset(s);
      for (let j = 0; j < perSector - 1; j++) {
        const w = dv.getUint32(off + j * 4, true);
        if (w !== FREESECT) difat.push(w);
      }
      s = dv.getUint32(off + ss - 4, true);
    }
    const fat = new Uint32Array(difat.length * perSector);
    for (let k = 0; k < difat.length; k++) {
      const so = this.sectorOffset(difat[k]!);
      for (let m = 0; m < perSector; m++) fat[k * perSector + m] = dv.getUint32(so + m * 4, true);
    }
    this.fat = fat;
  }

  private chain(start: number, table: Uint32Array): number[] {
    const out: number[] = [];
    let s = start;
    let guard = 0;
    const limit = table.length + 2;
    while (s !== ENDOFCHAIN && s !== FREESECT && s !== NOSTREAM) {
      if (guard++ > limit) throw new InvalidMsgError('Corrupt file: cycle in FAT chain');
      out.push(s);
      s = table[s]!;
      if (s === undefined) break;
    }
    return out;
  }

  private readDirectory(): void {
    const chain = this.chain(this.firstDirSector, this.fat);
    const ss = this.sectorSize;
    const dv = this.dv;
    const entries: CfbEntry[] = [];
    for (let c = 0; c < chain.length; c++) {
      const base = this.sectorOffset(chain[c]!);
      for (let e = 0; e < ss / 128; e++) {
        const off = base + e * 128;
        const nameLen = dv.getUint16(off + 64, true);
        let name = '';
        if (nameLen >= 2) {
          for (let i = 0; i < nameLen - 2; i += 2)
            name += String.fromCharCode(dv.getUint16(off + i, true));
        }
        entries.push({
          name,
          type: dv.getUint8(off + 66),
          left: dv.getUint32(off + 68, true),
          right: dv.getUint32(off + 72, true),
          child: dv.getUint32(off + 76, true),
          startSector: dv.getUint32(off + 116, true),
          size: dv.getUint32(off + 120, true) + dv.getUint32(off + 124, true) * 0x100000000,
        });
      }
    }
    this.entries = entries;
    this.rootChain = this.chain(entries[0]!.startSector, this.fat);
  }

  private readMiniFat(): void {
    const chain = this.chain(this.firstMiniFatSector, this.fat);
    const ss = this.sectorSize;
    const dv = this.dv;
    const mf = new Uint32Array(chain.length * (ss / 4));
    for (let c = 0; c < chain.length; c++) {
      const off = this.sectorOffset(chain[c]!);
      for (let i = 0; i < ss / 4; i++) mf[c * (ss / 4) + i] = dv.getUint32(off + i * 4, true);
    }
    this.miniFat = mf;
  }

  readStream(entry: CfbEntry): Uint8Array {
    const size = entry.size;
    const out = new Uint8Array(size);
    let pos = 0;
    if (entry === this.entries[0] || size >= this.miniStreamCutoff) {
      const chain = this.chain(entry.startSector, this.fat);
      for (let i = 0; i < chain.length && pos < size; i++) {
        const off = this.sectorOffset(chain[i]!);
        const n = Math.min(this.sectorSize, size - pos);
        out.set(this.bytes.subarray(off, off + n), pos);
        pos += n;
      }
    } else {
      const mchain = this.chain(entry.startSector, this.miniFat);
      for (let i = 0; i < mchain.length && pos < size; i++) {
        const byteOff = mchain[i]! * this.miniSectorSize;
        const sIdx = byteOff >> this.sectorShift;
        const within = byteOff & (this.sectorSize - 1);
        const off = this.sectorOffset(this.rootChain[sIdx]!) + within;
        const n = Math.min(this.miniSectorSize, size - pos);
        out.set(this.bytes.subarray(off, off + n), pos);
        pos += n;
      }
    }
    return out;
  }

  children(entryIndex: number): { index: number; entry: CfbEntry }[] {
    const result: { index: number; entry: CfbEntry }[] = [];
    const entries = this.entries;
    const start = entries[entryIndex]!.child;
    if (start === NOSTREAM) return result;
    const stack = [start];
    const seen: Record<number, boolean> = {};
    while (stack.length) {
      const id = stack.pop()!;
      if (id === NOSTREAM || id >= entries.length || seen[id]) continue;
      seen[id] = true;
      const en = entries[id]!;
      if (en.type !== 0) result.push({ index: id, entry: en });
      stack.push(en.left, en.right);
    }
    return result;
  }
}
