// Minimal OLE Compound File (v3, 512-byte sectors) builder for tests.
// All streams are stored via the regular FAT (mini-stream cutoff forced to 0),
// so the mini-FAT path is intentionally NOT exercised here — real .msg samples
// cover it in the snapshot tests.

export interface BuildStream {
  name: string;
  data: Uint8Array;
}
export interface BuildStorage {
  // Optional: unused for the root storage passed to buildCfb() (the root
  // directory entry's name is always the fixed 'Root Entry'); required in
  // spirit for nested storages, where callers always provide it.
  name?: string;
  streams?: BuildStream[];
  storages?: BuildStorage[];
}

const SECTOR = 512;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

interface DirNode {
  name: string;
  type: number; // 1 storage, 2 stream, 5 root
  data?: Uint8Array;
  children: DirNode[];
  startSector: number;
  size: number;
  left: number;
  right: number;
  child: number;
  index: number;
}

function pad(data: Uint8Array): number {
  return Math.max(1, Math.ceil(data.length / SECTOR));
}

/** Build a compound file buffer from a root storage tree. */
export function buildCfb(root: BuildStorage): ArrayBuffer {
  // Flatten into directory nodes (root first).
  const nodes: DirNode[] = [];
  function make(name: string, type: number): DirNode {
    const n: DirNode = {
      name,
      type,
      children: [],
      startSector: ENDOFCHAIN,
      size: 0,
      left: NOSTREAM,
      right: NOSTREAM,
      child: NOSTREAM,
      index: nodes.length,
    };
    nodes.push(n);
    return n;
  }
  function walk(node: DirNode, st: BuildStorage): void {
    for (const s of st.storages ?? []) {
      // Nested storages always provide a name; only the root passed to
      // buildCfb() may omit it (its directory name is fixed to 'Root Entry').
      const c = make(s.name!, 1);
      node.children.push(c);
      walk(c, s);
    }
    for (const strm of st.streams ?? []) {
      const c = make(strm.name, 2);
      c.data = strm.data;
      c.size = strm.data.length;
      node.children.push(c);
    }
  }
  const rootNode = make('Root Entry', 5);
  walk(rootNode, root);

  // Link children as a degenerate BST: child = first, then chain via `right`.
  for (const n of nodes) {
    if (n.children.length) {
      n.child = n.children[0]!.index;
      for (let i = 0; i < n.children.length - 1; i++) {
        n.children[i]!.right = n.children[i + 1]!.index;
      }
    }
  }

  // Allocate FAT sectors for every stream (and root has no stream data here).
  let nextSector = 0;
  const chains: { node: DirNode; sectors: number[] }[] = [];
  for (const n of nodes) {
    if (n.type === 2 && n.data && n.data.length) {
      const count = pad(n.data);
      const sectors: number[] = [];
      for (let i = 0; i < count; i++) sectors.push(nextSector++);
      n.startSector = sectors[0]!;
      chains.push({ node: n, sectors });
    }
  }

  // Directory sectors.
  const dirSectorsCount = Math.max(1, Math.ceil(nodes.length / 4)); // 4 entries per 512b sector
  const dirStart = nextSector;
  for (let i = 0; i < dirSectorsCount; i++) nextSector++;

  // FAT sector(s): each holds 128 entries. Total data+dir sectors known now,
  // plus the FAT sectors themselves. Iterate to a fixed point.
  let fatSectors = 1;
  for (;;) {
    const total = nextSector + fatSectors;
    const need = Math.ceil(total / 128);
    if (need <= fatSectors) break;
    fatSectors = need;
  }
  const fatStart = nextSector;
  for (let i = 0; i < fatSectors; i++) nextSector++;

  const totalSectors = nextSector;
  const fileSize = SECTOR + totalSectors * SECTOR; // header + sectors
  const buf = new ArrayBuffer(fileSize);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const sectorOffset = (s: number): number => SECTOR + s * SECTOR;

  // Header.
  dv.setUint32(0, 0xe011cfd0, true);
  dv.setUint32(4, 0xe11ab1a1, true);
  dv.setUint16(24, 0x003e, true); // minor version
  dv.setUint16(26, 0x0003, true); // major version 3
  dv.setUint16(28, 0xfffe, true); // byte order
  dv.setUint16(30, 9, true); // sector shift => 512
  dv.setUint16(32, 6, true); // mini sector shift => 64
  dv.setUint32(44, fatSectors, true); // number of FAT sectors
  dv.setUint32(48, dirStart, true); // first directory sector
  dv.setUint32(56, 0, true); // mini stream cutoff = 0 (force regular FAT)
  dv.setUint32(60, ENDOFCHAIN, true); // first mini FAT sector
  dv.setUint32(64, 0, true); // number of mini FAT sectors
  dv.setUint32(68, ENDOFCHAIN, true); // first DIFAT sector
  dv.setUint32(72, 0, true); // number of DIFAT sectors
  for (let i = 0; i < 109; i++)
    dv.setUint32(76 + i * 4, i < fatSectors ? fatStart + i : FREESECT, true);

  // FAT table (mark stream chains, directory chain, and FAT sectors).
  const fat = new Uint32Array(fatSectors * 128).fill(FREESECT);
  for (const { sectors } of chains) {
    for (let i = 0; i < sectors.length; i++) {
      fat[sectors[i]!] = i === sectors.length - 1 ? ENDOFCHAIN : sectors[i + 1]!;
    }
  }
  for (let i = 0; i < dirSectorsCount; i++) {
    fat[dirStart + i] = i === dirSectorsCount - 1 ? ENDOFCHAIN : dirStart + i + 1;
  }
  for (let i = 0; i < fatSectors; i++) fat[fatStart + i] = 0xfffffffd; // FATSECT marker

  // Write stream data.
  for (const { node, sectors } of chains) {
    bytes.set(node.data!, sectorOffset(sectors[0]!));
  }

  // Write directory entries (128 bytes each).
  for (const n of nodes) {
    const off = sectorOffset(dirStart) + n.index * 128;
    for (let i = 0; i < n.name.length; i++) dv.setUint16(off + i * 2, n.name.charCodeAt(i), true);
    const nameLen = (n.name.length + 1) * 2; // include terminating NUL
    dv.setUint16(off + 64, nameLen, true);
    dv.setUint8(off + 66, n.type);
    dv.setUint8(off + 67, 1); // color = black
    dv.setUint32(off + 68, n.left, true);
    dv.setUint32(off + 72, n.right, true);
    dv.setUint32(off + 76, n.child, true);
    dv.setUint32(off + 116, n.type === 2 ? n.startSector : ENDOFCHAIN, true);
    dv.setUint32(off + 120, n.size, true);
  }
  // Fill unused directory slots with type 0.
  for (let i = nodes.length; i < dirSectorsCount * 4; i++) {
    const off = sectorOffset(dirStart) + i * 128;
    dv.setUint32(off + 116, ENDOFCHAIN, true);
  }

  // Write FAT sectors.
  for (let i = 0; i < fat.length; i++) {
    dv.setUint32(sectorOffset(fatStart) + i * 4, fat[i]!, true);
  }

  return buf;
}
