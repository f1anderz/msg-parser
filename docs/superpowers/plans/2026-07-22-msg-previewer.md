# msg-previewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, dependency-free TypeScript library that parses Outlook `.msg` files and renders a sanitized, self-contained HTML preview string.

**Architecture:** Small single-purpose modules — `cfb` (OLE container reader), `encoding`, `rtf` (LZFu decompress + HTML de-encapsulation), `mapi` (property extraction), `message` (`parseMsg` orchestrator), `html` (`renderToHtml` string builder) — communicating through plain data with no DOM dependency. A known-good JS reference lives at `reference/msg-preview.js`; the algorithm-heavy modules are faithful, typed ports of it.

**Tech Stack:** TypeScript (strict), Vitest (unit + snapshot), tsup (ESM+CJS+d.ts), ESLint (typescript-eslint flat config), Prettier. Zero runtime dependencies.

## Global Constraints

- **Zero runtime dependencies.** Only universal `TextDecoder`, `ArrayBuffer`, `Uint8Array`, `Blob` may be used. No polyfills, no npm runtime deps.
- **All dev tools installed at latest stable** (`npm i -D <tool>@latest`). Record resolved versions in the README after install; never hardcode guessed versions.
- **TypeScript `strict: true`**, target ES2020, `moduleResolution: "bundler"`.
- **Node engine floor:** `>=18`.
- **License:** MIT.
- **Public API (exact names):** `parseMsg`, `renderToHtml`, `renderMsgFile`, `decompressRtf`, plus types `MsgMessage`, `MsgRecipient`, `MsgAttachment`, `RenderOptions`, and error `InvalidMsgError`.
- **Default date locale:** `'en-US'`.
- **TDD:** every task writes the failing test first, watches it fail, implements minimally, watches it pass, commits.
- **Reference porting:** `reference/msg-preview.js` is the source of truth for CFB/RTF/MAPI algorithms. Port faithfully; the reference is not published (`files` excludes it).
- **Commit style:** conventional commits (`feat:`, `test:`, `chore:`, `docs:`).

---

## Task 1: Repository scaffold

**Files:**

- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore` (exists — extend)
- Create: `src/index.ts`, `src/types.ts`
- Test: `test/unit/smoke.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: a buildable, lintable, testable package skeleton exporting the public types and a placeholder `version` constant. Public type shapes (used by every later task):

  ```ts
  interface MsgRecipient {
    name: string;
    email: string | null;
    type: 'to' | 'cc' | 'bcc';
  }
  interface MsgAttachment {
    name: string;
    mime: string | null;
    contentId: string | null;
    hidden: boolean;
    data: Uint8Array | null;
  }
  interface MsgMessage {
    subject: string;
    senderName: string;
    senderEmail: string | null;
    date: Date | null;
    headers: string | null;
    recipients: MsgRecipient[];
    bodyHtml: string | null;
    bodyText: string | null;
    bodyRtf: Uint8Array | null;
    attachments: MsgAttachment[];
  }
  interface RenderOptions {
    locale?: string;
    formatDate?: (d: Date) => string;
    showHiddenAttachments?: boolean;
    inlineImages?: boolean;
    blockRemoteImages?: boolean;
    fragment?: boolean;
  }
  ```

- [ ] **Step 1: Install tooling at latest stable**

Run:

```bash
npm init -y
npm i -D typescript@latest tsup@latest vitest@latest @vitest/coverage-v8@latest eslint@latest @eslint/js@latest typescript-eslint@latest prettier@latest
```

Expected: installs succeed; `node_modules/` and `package-lock.json` created.

- [ ] **Step 2: Write `package.json`** (replace the generated one)

```json
{
  "name": "msg-previewer",
  "version": "0.1.0",
  "description": "Dependency-free TypeScript library to parse and preview Outlook .msg files.",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=18" },
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "prepare": "tsup",
    "prepublishOnly": "npm run typecheck && npm run lint && npm run test && npm run build"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test"],
  "exclude": ["node_modules", "dist", "reference"]
}
```

Note: `"lib"` includes `DOM` only for the `Blob`/`File` types used by `renderMsgFile`; no DOM APIs are called in parsing.

- [ ] **Step 4: Write `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
});
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/types.ts'],
      reporter: ['text', 'html'],
    },
  },
});
```

- [ ] **Step 6: Write `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'reference', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript already resolves identifiers (TextDecoder, DataView, Blob, ...);
      // the core rule produces false positives on platform globals in TS files.
      'no-undef': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
```

- [ ] **Step 7: Write `.prettierrc`, `.prettierignore`, extend `.gitignore`**

`.prettierrc`:

```json
{ "singleQuote": true, "semi": true, "trailingComma": "all", "printWidth": 100 }
```

`.prettierignore`:

```
dist
node_modules
coverage
reference
```

Append to `.gitignore` (already contains `node_modules/`, `dist/`, `coverage/`):

```
package-lock.json
```

Note: keep `package-lock.json` out of git for a library, or commit it per team preference. Default here: ignore it.

- [ ] **Step 8: Write `src/types.ts`**

```ts
export interface MsgRecipient {
  name: string;
  email: string | null;
  type: 'to' | 'cc' | 'bcc';
}

export interface MsgAttachment {
  name: string;
  mime: string | null;
  contentId: string | null;
  hidden: boolean;
  data: Uint8Array | null;
}

export interface MsgMessage {
  subject: string;
  senderName: string;
  senderEmail: string | null;
  date: Date | null;
  headers: string | null;
  recipients: MsgRecipient[];
  bodyHtml: string | null;
  bodyText: string | null;
  bodyRtf: Uint8Array | null;
  attachments: MsgAttachment[];
}

export interface RenderOptions {
  /** BCP-47 locale for date formatting. Default 'en-US'. */
  locale?: string;
  /** Custom date formatter; overrides `locale`. */
  formatDate?: (d: Date) => string;
  /** Include hidden/inline attachments in the attachment list. Default false. */
  showHiddenAttachments?: boolean;
  /** Embed inline cid: images as data: URIs. Default true. */
  inlineImages?: boolean;
  /** Neutralize external http(s) image sources. Default false. */
  blockRemoteImages?: boolean;
  /** Return only the inner HTML fragment, not a full document. Default false. */
  fragment?: boolean;
}

export class InvalidMsgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMsgError';
  }
}
```

- [ ] **Step 9: Write `src/index.ts`** (placeholder, real exports added later)

```ts
export * from './types.js';

export const version = '0.1.0';
```

- [ ] **Step 10: Write the smoke test `test/unit/smoke.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { version, InvalidMsgError } from '../../src/index.js';

describe('package smoke', () => {
  it('exposes a version string', () => {
    expect(version).toBe('0.1.0');
  });

  it('exposes InvalidMsgError', () => {
    const err = new InvalidMsgError('bad');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidMsgError');
  });
});
```

- [ ] **Step 11: Run the full toolchain**

Run:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: typecheck clean; ESLint no errors; 2 tests pass; `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts` produced.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold msg-previewer package (ts, tsup, vitest, eslint, prettier)"
```

---

## Task 2: encoding module

**Files:**

- Create: `src/encoding/codepage.ts`, `src/encoding/decode.ts`, `src/encoding/index.ts`
- Test: `test/unit/encoding.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  ```ts
  function codepageToLabel(cp: number | null | undefined): string | null;
  function decodeBytes(bytes: Uint8Array, label?: string | null): string;
  function decodeUtf16le(bytes: Uint8Array): string;
  function filetimeToDate(lo: number, hi: number): Date;
  ```
  These are consumed by `rtf`, `mapi`, and `message`.

Port from `reference/msg-preview.js`: `codepageToLabel` (lines 179–194), `decodeBytes`/`decodeUtf16` (196–203), `filetimeToDate` (205–209).

- [ ] **Step 1: Write the failing test `test/unit/encoding.test.ts`**

```ts
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
    // 2021-01-01T00:00:00Z == 132223104000000000 100ns ticks since 1601.
    const ticks = 132223104000000000;
    const lo = ticks % 4294967296;
    const hi = Math.floor(ticks / 4294967296);
    const d = filetimeToDate(lo, hi);
    expect(d.toISOString()).toBe('2021-01-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/encoding.test.ts`
Expected: FAIL — cannot resolve `../../src/encoding/index.js`.

- [ ] **Step 3: Implement `src/encoding/codepage.ts`**

```ts
/** Map a Windows codepage number to a TextDecoder label, or null if unsupported. */
export function codepageToLabel(cp: number | null | undefined): string | null {
  if (!cp) return null;
  if (cp === 65001) return 'utf-8';
  if (cp === 65000) return 'utf-7';
  if (cp === 20127) return 'ascii';
  if (cp === 28591) return 'iso-8859-1';
  if (cp === 20866) return 'koi8-r';
  if (cp === 21866) return 'koi8-u';
  if (cp === 932) return 'shift_jis';
  if (cp === 936) return 'gbk';
  if (cp === 949) return 'euc-kr';
  if (cp === 950) return 'big5';
  if (cp >= 1250 && cp <= 1258) return 'windows-' + cp;
  if (cp >= 28592 && cp <= 28606) return 'iso-8859-' + (cp - 28590);
  return null;
}
```

- [ ] **Step 4: Implement `src/encoding/decode.ts`**

```ts
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
```

- [ ] **Step 5: Implement `src/encoding/index.ts`**

```ts
export { codepageToLabel } from './codepage.js';
export { decodeBytes, decodeUtf16le, filetimeToDate } from './decode.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/unit/encoding.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add encoding module (codepage, decode, filetime)"
```

---

## Task 3: CFB (OLE Compound File) reader + test builder

**Files:**

- Create: `src/cfb/cfb.ts`, `src/cfb/index.ts`
- Create: `test/helpers/build-cfb.ts` (test-only synthetic compound-file builder)
- Test: `test/unit/cfb.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  ```ts
  interface CfbEntry {
    name: string;
    type: number; // 0=unused, 1=storage, 2=stream, 5=root
    left: number;
    right: number;
    child: number;
    startSector: number;
    size: number;
  }
  class Cfb {
    constructor(buf: ArrayBuffer);
    entries: CfbEntry[];
    readStream(entry: CfbEntry): Uint8Array;
    children(entryIndex: number): { index: number; entry: CfbEntry }[];
  }
  ```
  `Cfb` is consumed by `mapi` and `message`. The test builder `buildCfb` is consumed by `cfb`, `message`, and `html` tests.

Port the reader from `reference/msg-preview.js` `CFB` (lines 25–175): `_parseHeader`, `_sectorOffset`, `_readFAT`, `_chain`, `_readDirectory`, `_readMiniFAT`, `readStream`, `children`. Translate to a TS class with the fields above. Throw `InvalidMsgError` (not a bare `Error`) on a bad signature.

**Builder simplification:** `buildCfb` writes all streams through the regular FAT by setting the header's mini-stream cutoff to `0`, so the mini-FAT path is not exercised by synthetic fixtures. The mini-FAT read path is covered later by real-sample snapshot tests (Task 9). Document this in a comment.

- [ ] **Step 1: Write the test builder `test/helpers/build-cfb.ts`**

```ts
// Minimal OLE Compound File (v3, 512-byte sectors) builder for tests.
// All streams are stored via the regular FAT (mini-stream cutoff forced to 0),
// so the mini-FAT path is intentionally NOT exercised here — real .msg samples
// cover it in the snapshot tests.

export interface BuildStream {
  name: string;
  data: Uint8Array;
}
export interface BuildStorage {
  name: string;
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
      const c = make(s.name, 1);
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
```

- [ ] **Step 2: Write the failing test `test/unit/cfb.test.ts`**

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/unit/cfb.test.ts`
Expected: FAIL — cannot resolve `../../src/cfb/index.js`.

- [ ] **Step 4: Implement `src/cfb/cfb.ts`**

Port the reference `CFB` (lines 25–175) into this typed class. Preserve the algorithm exactly; only the signature check throws `InvalidMsgError`.

```ts
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
```

- [ ] **Step 5: Implement `src/cfb/index.ts`**

```ts
export { Cfb } from './cfb.js';
export type { CfbEntry } from './cfb.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/unit/cfb.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add CFB compound-file reader with synthetic test builder"
```

---

## Task 4: RTF decompression (LZFu / MELA)

**Files:**

- Create: `src/rtf/decompress.ts`
- Test: `test/unit/rtf-decompress.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `function decompressRtf(bytes: Uint8Array): Uint8Array | null;` — consumed by `message` and re-exported publicly.

Port from `reference/msg-preview.js`: `LZFU_PREFILL` (213–216) and `decompressRTF` (218–253). Keep byte-for-byte identical logic.

- [ ] **Step 1: Write the failing test `test/unit/rtf-decompress.test.ts`**

The test builds a valid LZFu container by round-tripping through the reference. To avoid depending on the reference at test time, we assert on two constructed inputs: a MELA (uncompressed) container and a hand-built LZFu stream that emits only literal bytes (control byte `0x00` selects 8 literals).

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/rtf-decompress.test.ts`
Expected: FAIL — cannot resolve `../../src/rtf/decompress.js`.

- [ ] **Step 3: Implement `src/rtf/decompress.ts`**

```ts
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
  if (magic === 0x414c454d) return bytes.slice(16, 16 + rawSize); // "MELA" — uncompressed
  if (magic !== 0x75465a4c) return null; // not "LZFu"
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/rtf-decompress.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add RTF LZFu/MELA decompression"
```

---

## Task 5: RTF → HTML de-encapsulation and RTF → text

**Files:**

- Create: `src/rtf/deencapsulate.ts`, `src/rtf/to-text.ts`, `src/rtf/index.ts`
- Test: `test/unit/rtf-html.test.ts`

**Interfaces:**

- Consumes: `decodeBytes`, `codepageToLabel` from `encoding`; `decompressRtf` re-export.
- Produces:
  ```ts
  function deencapsulateHtml(rtfBytes: Uint8Array): string | null;
  function rtfToText(rtfBytes: Uint8Array, cpLabel: string | null): string;
  ```
  Consumed by `message`.

Port from `reference/msg-preview.js`: `CHARSET_TO_CP` (255–256), `rtfFontCodepages` (258–266), `rtfDeencapsulateHtml` (270–336), `rtfToText` (339–390). The reference `decodeBytes(bytes, 'ascii')` calls become `decodeBytes(bytes, 'ascii')` from our encoding module.

- [ ] **Step 1: Write the failing test `test/unit/rtf-html.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { deencapsulateHtml, rtfToText } from '../../src/rtf/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('deencapsulateHtml', () => {
  it('returns null when RTF is not \\fromhtml', () => {
    expect(deencapsulateHtml(enc('{\\rtf1\\ansi plain text}'))).toBeNull();
  });

  it('extracts HTML from a \\fromhtml encapsulated RTF', () => {
    const rtf =
      '{\\rtf1\\ansi\\fromhtml1 \\htmlrtf0 ' +
      '{\\*\\htmltag84 <html>}{\\*\\htmltag <body>}Hello{\\*\\htmltag </body>}{\\*\\htmltag </html>}}';
    const html = deencapsulateHtml(enc(rtf));
    expect(html).not.toBeNull();
    expect(html).toContain('<html>');
    expect(html).toContain('Hello');
    expect(html).toContain('</html>');
  });
});

describe('rtfToText', () => {
  it('extracts visible text and drops control groups', () => {
    const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello\\par world}';
    const text = rtfToText(enc(rtf), 'windows-1252');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).not.toContain('fonttbl');
    expect(text).not.toContain('Arial');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/rtf-html.test.ts`
Expected: FAIL — cannot resolve `../../src/rtf/index.js`.

- [ ] **Step 3: Implement `src/rtf/deencapsulate.ts`**

Port `CHARSET_TO_CP`, `rtfFontCodepages`, and `rtfDeencapsulateHtml` from the reference. Typed version:

```ts
import { codepageToLabel, decodeBytes } from '../encoding/index.js';

const CHARSET_TO_CP: Record<number, number> = {
  0: 1252,
  128: 932,
  129: 949,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
};

function rtfFontCodepages(s: string, defaultLabel: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /\\f(\d+)[\\a-z0-9\- ]*?\\fcharset(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const cp = CHARSET_TO_CP[parseInt(m[2]!, 10)];
    map[m[1]!] = (cp && codepageToLabel(cp)) || defaultLabel;
  }
  return map;
}

/** De-encapsulate HTML stored inside \fromhtml RTF (MS-OXRTFEX). Null if not present. */
export function deencapsulateHtml(rtfBytes: Uint8Array): string | null {
  const s = decodeBytes(rtfBytes, 'ascii');
  if (!/\\fromhtml/.test(s.slice(0, 400))) return null;
  const mcp = /\\ansicpg(\d+)/.exec(s.slice(0, 200));
  const defaultCp = (mcp && codepageToLabel(parseInt(mcp[1]!, 10))) || 'windows-1252';
  const fontCp = rtfFontCodepages(s, defaultCp);
  let curCp = defaultCp;
  const destSkip: Record<string, number> = {
    fonttbl: 1,
    colortbl: 1,
    stylesheet: 1,
    info: 1,
    generator: 1,
    pntext: 1,
    themedata: 1,
    colorschememapping: 1,
  };
  const out: string[] = [];
  let pending: number[] = [];
  let i = 0;
  const n = s.length;
  let depth = 0;
  let suppress = false;
  let htmltagDepth = 0;
  let skipDepth = 0;
  const emitting = (): boolean => htmltagDepth > 0 || (!suppress && !skipDepth);
  const flush = (): void => {
    if (pending.length) {
      out.push(decodeBytes(new Uint8Array(pending), curCp));
      pending = [];
    }
  };
  while (i < n) {
    const c = s[i]!;
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      if (skipDepth && depth < skipDepth) skipDepth = 0;
      if (htmltagDepth && depth < htmltagDepth) {
        flush();
        htmltagDepth = 0;
      }
      i++;
      continue;
    }
    if (c === '\\') {
      const c2 = s[i + 1];
      if (c2 === "'") {
        if (emitting()) pending.push(parseInt(s.substr(i + 2, 2), 16));
        i += 4;
        continue;
      }
      if (c2 === '\\' || c2 === '{' || c2 === '}') {
        if (emitting()) pending.push(c2.charCodeAt(0));
        i += 2;
        continue;
      }
      if (c2 === '~') {
        if (emitting()) {
          flush();
          out.push(' ');
        }
        i += 2;
        continue;
      }
      if (c2 === '*') {
        const mt = /^\\\*\\htmltag(\d+)? ?/.exec(s.substr(i, 24));
        if (mt) {
          htmltagDepth = depth;
          i += mt[0].length;
        } else {
          skipDepth = depth;
          i += 2;
        }
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.substr(i, 34));
      if (m) {
        i += m[0].length;
        const word = m[1]!;
        const num = m[2] ? parseInt(m[2], 10) : null;
        if (destSkip[word] && !htmltagDepth) {
          skipDepth = depth;
          continue;
        }
        if (word === 'htmlrtf') {
          suppress = num !== 0;
          continue;
        }
        if (word === 'f' && num !== null) {
          flush();
          curCp = fontCp[num] || defaultCp;
          continue;
        }
        if (!emitting()) continue;
        flush();
        if (word === 'par' || word === 'line') out.push('\r\n');
        else if (word === 'tab') out.push('\t');
        else if (word === 'u' && num !== null) {
          out.push(String.fromCharCode(num < 0 ? num + 65536 : num));
          if (s[i] === '?') i++;
        }
        continue;
      }
      i += 2;
      continue;
    }
    if (c !== '\r' && c !== '\n') {
      if (emitting()) pending.push(s.charCodeAt(i));
    }
    i++;
  }
  flush();
  const html = out.join('');
  return /</.test(html) ? html : null;
}
```

- [ ] **Step 4: Implement `src/rtf/to-text.ts`**

Port `rtfToText` from the reference (339–390):

```ts
import { decodeBytes } from '../encoding/index.js';

/** Best-effort RTF → plain text fallback. */
export function rtfToText(rtfBytes: Uint8Array, cpLabel: string | null): string {
  const s = decodeBytes(rtfBytes, 'ascii');
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  const skipGroups: Record<string, number> = {
    fonttbl: 1,
    colortbl: 1,
    stylesheet: 1,
    info: 1,
    pict: 1,
    generator: 1,
    themedata: 1,
    colorschememapping: 1,
    datastore: 1,
  };
  let skipDepth = 0;
  let depth = 0;
  let pendingBytes: number[] = [];
  const flushBytes = (): void => {
    if (pendingBytes.length) {
      out.push(decodeBytes(new Uint8Array(pendingBytes), cpLabel));
      pendingBytes = [];
    }
  };
  while (i < n) {
    const c = s[i]!;
    if (c === '{') {
      depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      if (skipDepth && depth < skipDepth) skipDepth = 0;
      i++;
      continue;
    }
    if (c === '\\') {
      i++;
      const c2 = s[i];
      if (c2 === "'") {
        const hex = s.substr(i + 1, 2);
        i += 3;
        if (!skipDepth) pendingBytes.push(parseInt(hex, 16));
        continue;
      }
      if (c2 === '\\' || c2 === '{' || c2 === '}') {
        if (!skipDepth) {
          flushBytes();
          out.push(c2);
        }
        i++;
        continue;
      }
      if (c2 === '*') {
        i++;
        continue;
      }
      if (c2 === '~') {
        if (!skipDepth) {
          flushBytes();
          out.push(' ');
        }
        i++;
        continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.substr(i, 32));
      if (m) {
        i += m[0].length;
        const word = m[1]!;
        const num = m[2] ? parseInt(m[2], 10) : null;
        if (skipGroups[word]) {
          skipDepth = depth;
          continue;
        }
        if (skipDepth) continue;
        flushBytes();
        if (word === 'par' || word === 'line') out.push('\n');
        else if (word === 'tab') out.push('\t');
        else if (word === 'u' && num !== null) {
          out.push(String.fromCharCode(num < 0 ? num + 65536 : num));
          if (s[i] === '?') i++;
        }
        continue;
      }
      i++;
      continue;
    }
    if (!skipDepth && c !== '\r' && c !== '\n') pendingBytes.push(s.charCodeAt(i));
    i++;
  }
  flushBytes();
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 5: Implement `src/rtf/index.ts`**

```ts
export { decompressRtf } from './decompress.js';
export { deencapsulateHtml } from './deencapsulate.js';
export { rtfToText } from './to-text.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/unit/rtf-html.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add RTF HTML de-encapsulation and text fallback"
```

---

## Task 6: MAPI property extraction

**Files:**

- Create: `src/mapi/props.ts`, `src/mapi/index.ts`
- Test: `test/unit/mapi.test.ts`

**Interfaces:**

- Consumes: `Cfb`, `CfbEntry` from `cfb`; `decodeBytes`, `decodeUtf16le`, `filetimeToDate`, `codepageToLabel` from `encoding`.
- Produces:
  ```ts
  interface RawProp {
    type: string;
    bytes?: Uint8Array;
    value?: unknown;
    storageIndex?: number;
  }
  interface StorageProps {
    props: Record<string, RawProp>;
    fixed?: Uint8Array;
    subStorages: { name: string; index: number }[];
  }
  function readSubStorageProps(cfb: Cfb, entryIndex: number): StorageProps;
  function parseFixedProps(
    bytes: Uint8Array | undefined,
    headerSize: number,
    props: Record<string, RawProp>,
  ): void;
  function makeGetter(
    props: Record<string, RawProp>,
    cpLabel: string | null,
  ): (id: string) => string | number | boolean | Date | Uint8Array | null;
  function detectCodepage(props: Record<string, RawProp>): string | null;
  ```
  Consumed by `message`.

Port from `reference/msg-preview.js`: `readSubStorageProps` (394–415), `parseFixedProps` (417–436), `makeGetter` (438–448), `detectCodepage` (450–461). The reference stored the `__properties_version1.0` bytes under a `props.__fixed` key; in the typed port we return it as a separate `fixed` field on `StorageProps` (avoids an index-signature conflict), and `props` holds only `RawProp` values.

- [ ] **Step 1: Write the failing test `test/unit/mapi.test.ts`**

```ts
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
      storages: [
        { name: '__recip_version1.0_#00000000' },
        { name: '__attach_version1.0_#00000000' },
      ],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/mapi.test.ts`
Expected: FAIL — cannot resolve `../../src/mapi/index.js`.

- [ ] **Step 3: Implement `src/mapi/props.ts`**

Port faithfully; typed. `props.__fixed` holds a `Uint8Array`; other entries hold `RawProp`.

```ts
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
    let value: unknown = null;
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
    if (cp && iso2022[cp]) cp = iso2022[cp];
  }
  return codepageToLabel(cp);
}
```

- [ ] **Step 4: Implement `src/mapi/index.ts`**

```ts
export { readSubStorageProps, parseFixedProps, makeGetter, detectCodepage } from './props.js';
export type { RawProp, StorageProps } from './props.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/unit/mapi.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add MAPI property extraction"
```

---

## Task 7: message orchestrator (`parseMsg`)

**Files:**

- Create: `src/message/parse.ts`, `src/message/index.ts`
- Test: `test/unit/parse.test.ts`

**Interfaces:**

- Consumes: `Cfb` (cfb); `readSubStorageProps`, `parseFixedProps`, `makeGetter`, `detectCodepage` (mapi); `decompressRtf`, `deencapsulateHtml`, `rtfToText` (rtf); `codepageToLabel` (encoding); `MsgMessage`, `InvalidMsgError` (types).
- Produces: `function parseMsg(input: ArrayBuffer | Uint8Array): MsgMessage;` — consumed by `html` and the public API.

Port `decodeHtmlBody` (463–469), `parseStorageAsMessage` (471–566) and `parse` (568–574). Drop the embedded-`.msg` branch (deferred): if an attachment's data property is an embedded storage (`type === '000D'`), set `data = null` and keep the display name — do NOT recurse.

- [ ] **Step 1: Write the failing test `test/unit/parse.test.ts`**

Builds a synthetic top-level message with a unicode subject, an HTML body stream, one recipient substorage, and one attachment substorage.

```ts
import { describe, expect, it } from 'vitest';
import { parseMsg } from '../../src/message/index.js';
import { InvalidMsgError } from '../../src/types.js';
import { buildCfb } from '../helpers/build-cfb.js';

const utf16 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
};
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

// A recipient type fixed prop (0C15 = recipient type, 0003 int). To=1.
function recipTypeStream(type: number): Uint8Array {
  const rec = new Uint8Array(8 + 16);
  const dv = new DataView(rec.buffer);
  dv.setUint16(8, 0x0003, true);
  dv.setUint16(10, 0x0c15, true);
  dv.setInt32(rec.length - 8, type, true);
  return rec;
}

describe('parseMsg', () => {
  it('throws InvalidMsgError on non-.msg input', () => {
    expect(() => parseMsg(new Uint8Array(600))).toThrow(InvalidMsgError);
  });

  it('parses subject, html body, recipient and attachment', () => {
    const buf = buildCfb({
      streams: [
        { name: '__substg1.0_0037001F', data: utf16('Test subject') },
        { name: '__substg1.0_5D02001F', data: utf16('Alice Sender') },
        { name: '__substg1.0_1013001F', data: utf16('<p>Hi there</p>') },
      ],
      storages: [
        {
          name: '__recip_version1.0_#00000000',
          streams: [
            { name: '__substg1.0_3001001F', data: utf16('Bob') },
            { name: '__substg1.0_39FE001F', data: utf16('bob@example.com') },
            { name: '__properties_version1.0', data: recipTypeStream(1) },
          ],
        },
        {
          name: '__attach_version1.0_#00000000',
          streams: [
            { name: '__substg1.0_3707001F', data: utf16('file.txt') },
            { name: '__substg1.0_37010102', data: ascii('file-bytes') },
          ],
        },
      ],
    });
    const msg = parseMsg(buf);
    expect(msg.subject).toBe('Test subject');
    expect(msg.senderName).toBe('Alice Sender');
    expect(msg.bodyHtml).toBe('<p>Hi there</p>');
    expect(msg.recipients).toEqual([{ name: 'Bob', email: 'bob@example.com', type: 'to' }]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]!.name).toBe('file.txt');
    expect(new TextDecoder().decode(msg.attachments[0]!.data!)).toBe('file-bytes');
  });

  it('accepts a Uint8Array input', () => {
    const buf = buildCfb({ streams: [{ name: '__substg1.0_0037001F', data: utf16('S') }] });
    expect(parseMsg(new Uint8Array(buf)).subject).toBe('S');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/parse.test.ts`
Expected: FAIL — cannot resolve `../../src/message/index.js`.

- [ ] **Step 3: Implement `src/message/parse.ts`**

```ts
import { Cfb } from '../cfb/index.js';
import { codepageToLabel } from '../encoding/index.js';
import { detectCodepage, makeGetter, parseFixedProps, readSubStorageProps } from '../mapi/index.js';
import { decompressRtf, deencapsulateHtml, rtfToText } from '../rtf/index.js';
import type { MsgMessage } from '../types.js';

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function decodeHtmlBody(bytes: Uint8Array, htmlCpLabel: string | null): string {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 2048)));
  const m = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  const label = (m && m[1]!.toLowerCase()) || htmlCpLabel || 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function parseStorageAsMessage(cfb: Cfb, entryIndex: number, isTopLevel: boolean): MsgMessage {
  const st = readSubStorageProps(cfb, entryIndex);
  const { props } = st;
  parseFixedProps(st.fixed, isTopLevel ? 32 : 24, props);
  const cpLabel = detectCodepage(props);
  const get = makeGetter(props, cpLabel);

  const msg: MsgMessage = {
    subject: asString(get('0037')) ?? asString(get('0E1D')) ?? '',
    senderName: asString(get('5D02')) ?? asString(get('0C1A')) ?? asString(get('0042')) ?? '',
    senderEmail: asString(get('5D01')) ?? asString(get('5D0A')) ?? null,
    date:
      get('0E06') instanceof Date
        ? (get('0E06') as Date)
        : get('0039') instanceof Date
          ? (get('0039') as Date)
          : null,
    headers: asString(get('007D')),
    recipients: [],
    attachments: [],
    bodyText: asString(get('1000')),
    bodyHtml: null,
    bodyRtf: null,
  };

  if (!msg.senderEmail) {
    const addr = asString(get('0C1F')) ?? asString(get('0065'));
    if (addr && addr.indexOf('@') > 0) msg.senderEmail = addr;
  }

  // HTML body
  const htmlProp = props['1013'];
  if (htmlProp && htmlProp.bytes) {
    const cp3fde =
      props['3FDE'] && 'value' in props['3FDE'] ? (props['3FDE'].value as number) : null;
    const htmlCp = codepageToLabel(cp3fde) || cpLabel;
    msg.bodyHtml = decodeHtmlBody(htmlProp.bytes, htmlCp);
  } else if (htmlProp && htmlProp.type === '001F') {
    msg.bodyHtml = asString(get('1013'));
  }

  // RTF body (compressed)
  const rtfProp = props['1009'];
  if (rtfProp && rtfProp.bytes) {
    const rtf = decompressRtf(rtfProp.bytes);
    if (rtf) {
      msg.bodyRtf = rtf;
      if (!msg.bodyHtml) {
        try {
          msg.bodyHtml = deencapsulateHtml(rtf);
        } catch {
          /* ignore */
        }
      }
      if (!msg.bodyText && !msg.bodyHtml) {
        try {
          msg.bodyText = rtfToText(rtf, cpLabel);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Recipients and attachments
  for (const sub of st.subStorages) {
    const name = sub.name;
    if (name.indexOf('__recip_version1.0_') === 0) {
      const r = readSubStorageProps(cfb, sub.index);
      parseFixedProps(r.fixed, 8, r.props);
      const rg = makeGetter(r.props, cpLabel);
      const rtype = rg('0C15');
      const smtp = asString(rg('39FE')) ?? asString(rg('3003'));
      msg.recipients.push({
        name: asString(rg('3001')) ?? '',
        email: smtp && smtp.indexOf('@') > 0 ? smtp : null,
        type: rtype === 2 ? 'cc' : rtype === 3 ? 'bcc' : 'to',
      });
    } else if (name.indexOf('__attach_version1.0_') === 0) {
      const a = readSubStorageProps(cfb, sub.index);
      parseFixedProps(a.fixed, 8, a.props);
      const ag = makeGetter(a.props, cpLabel);
      const dataProp = a.props['3701'];
      const att = {
        name: asString(ag('3707')) ?? asString(ag('3704')) ?? asString(ag('3001')) ?? 'attachment',
        mime: asString(ag('370E')),
        contentId: asString(ag('3712')),
        hidden: ag('7FFE') === true,
        data: null as Uint8Array | null,
      };
      if (dataProp) {
        if (dataProp.bytes) att.data = dataProp.bytes;
        // Embedded .msg (type 000D) is deferred: leave data null, keep display name.
        else if (dataProp.storageIndex !== undefined && dataProp.type === '000D') {
          att.name = asString(ag('3001')) ?? att.name;
        }
      }
      msg.attachments.push(att);
    }
  }

  const order: Record<string, number> = { to: 0, cc: 1, bcc: 2 };
  msg.recipients.sort((x, y) => order[x.type]! - order[y.type]!);
  return msg;
}

/** Parse a .msg byte buffer into a structured message object. */
export function parseMsg(input: ArrayBuffer | Uint8Array): MsgMessage {
  // Normalize to a standalone ArrayBuffer (copy, so we own a contiguous region).
  let buffer: ArrayBuffer;
  if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    buffer = copy.buffer;
  } else {
    buffer = input;
  }
  const cfb = new Cfb(buffer);
  return parseStorageAsMessage(cfb, 0, true);
}
```

- [ ] **Step 4: Implement `src/message/index.ts`**

```ts
export { parseMsg } from './parse.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/unit/parse.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add parseMsg message orchestrator"
```

---

## Task 8: HTML renderer (`renderToHtml`, `renderMsgFile`) + public API

**Files:**

- Create: `src/html/sanitize.ts`, `src/html/styles.ts`, `src/html/render.ts`, `src/html/index.ts`
- Modify: `src/index.ts`
- Test: `test/unit/render.test.ts`

**Interfaces:**

- Consumes: `parseMsg` (message); `MsgMessage`, `MsgAttachment`, `RenderOptions` (types).
- Produces:
  ```ts
  function sanitizeHtml(html: string): string;
  function renderToHtml(
    input: MsgMessage | ArrayBuffer | Uint8Array,
    options?: RenderOptions,
  ): string;
  function renderMsgFile(
    input: File | Blob | ArrayBuffer | Uint8Array,
    options?: RenderOptions,
  ): Promise<string>;
  ```
  These plus `parseMsg`, `decompressRtf`, and the types form the public API.

Port `esc`, `fmtSize`, `fmtWho`, `sanitizeHtml`, and the body/attachment assembly logic from the reference `render` (609–736). Key differences from the reference: output is a **string** (not DOM); inline `cid:` images become **`data:` base64 URIs** (a pure base64 encoder, no `btoa` dependency); no auto-height iframe script.

- [ ] **Step 1: Write the failing test `test/unit/render.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { sanitizeHtml, renderToHtml, renderMsgFile } from '../../src/html/index.js';
import type { MsgMessage } from '../../src/types.js';
import { buildCfb } from '../helpers/build-cfb.js';

const utf16 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
};

function msgBytes(): ArrayBuffer {
  return buildCfb({ streams: [{ name: '__substg1.0_0037001F', data: utf16('From file') }] });
}

function msg(overrides: Partial<MsgMessage> = {}): MsgMessage {
  return {
    subject: 'Subj',
    senderName: 'Alice',
    senderEmail: 'alice@example.com',
    date: new Date('2021-01-01T00:00:00Z'),
    headers: null,
    recipients: [{ name: 'Bob', email: 'bob@example.com', type: 'to' }],
    bodyHtml: '<p>Body</p>',
    bodyText: null,
    bodyRtf: null,
    attachments: [],
    ...overrides,
  };
}

describe('sanitizeHtml', () => {
  it('strips scripts, event handlers and javascript: URIs', () => {
    const dirty = `<div onclick="x()"><script>alert(1)</script><a href="javascript:evil()">y</a></div>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
  });
});

describe('renderToHtml', () => {
  it('renders a full self-contained document with header and body', () => {
    const html = renderToHtml(msg());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Subj');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('bob@example.com');
    expect(html).toContain('<p>Body</p>');
  });

  it('returns only a fragment when fragment:true', () => {
    const html = renderToHtml(msg(), { fragment: true });
    expect(html).not.toContain('<!doctype');
    expect(html).toContain('Subj');
  });

  it('inlines cid: images as data: URIs', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const html = renderToHtml(
      msg({
        bodyHtml: '<img src="cid:img1">',
        attachments: [
          { name: 'i.png', mime: 'image/png', contentId: 'img1', hidden: true, data: png },
        ],
      }),
    );
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('cid:img1');
  });

  it('lists visible attachments with size', () => {
    const html = renderToHtml(
      msg({
        attachments: [
          {
            name: 'doc.pdf',
            mime: 'application/pdf',
            contentId: null,
            hidden: false,
            data: new Uint8Array(2048),
          },
        ],
      }),
    );
    expect(html).toContain('doc.pdf');
    expect(html).toContain('2.0');
  });

  it('falls back to plain text body', () => {
    const html = renderToHtml(msg({ bodyHtml: null, bodyText: 'just text' }));
    expect(html).toContain('just text');
  });
});

describe('renderMsgFile', () => {
  it('renders from an ArrayBuffer', async () => {
    const html = await renderMsgFile(msgBytes());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('From file');
  });

  it('renders from a Blob', async () => {
    const blob = new Blob([msgBytes()]);
    const html = await renderMsgFile(blob);
    expect(html).toContain('From file');
  });
});
```

Note: `renderMsgFile` accepts `File | Blob | ArrayBuffer | Uint8Array`; `File` extends `Blob`, so the `Blob` test covers the browser file-input path.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/render.test.ts`
Expected: FAIL — cannot resolve `../../src/html/index.js`.

- [ ] **Step 3: Implement `src/html/sanitize.ts`**

```ts
/** Defense-in-depth HTML sanitization. The primary boundary is the consumer's sandboxed iframe. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(<\w[^>]*\s(?:href|src)\s*=\s*["']?)\s*javascript:/gi, '$1blocked:');
}

/** Neutralize external http(s) image sources (used when blockRemoteImages is set). */
export function blockRemoteImages(html: string): string {
  return html.replace(/(<img\b[^>]*\ssrc\s*=\s*["']?)\s*https?:\/\/[^"'\s>]*/gi, '$1blocked:');
}
```

- [ ] **Step 4: Implement `src/html/styles.ts`**

```ts
export const PREVIEW_CSS = [
  '.msgp{font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2733;',
  'border:1px solid #d7dde6;border-radius:10px;overflow:hidden;background:#fff}',
  '.msgp-head{padding:16px 20px;border-bottom:1px solid #e6ebf2;background:#f7f9fc}',
  '.msgp-subject{font-size:18px;font-weight:650;margin:0 0 10px}',
  '.msgp-row{display:flex;gap:8px;margin:2px 0;font-size:13px}',
  '.msgp-label{color:#69758a;min-width:56px;flex:none}',
  '.msgp-who b{font-weight:600}.msgp-who span{color:#69758a}',
  '.msgp-date{color:#69758a;font-size:12.5px;margin-top:6px}',
  '.msgp-body{padding:16px 20px;word-wrap:break-word}',
  '.msgp-body pre{margin:0;white-space:pre-wrap;word-wrap:break-word}',
  '.msgp-atts{display:flex;flex-wrap:wrap;gap:8px;padding:12px 20px;border-top:1px solid #e6ebf2;background:#fafbfd}',
  '.msgp-att{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #d7dde6;',
  'border-radius:999px;font-size:12.5px;color:#1f2733;text-decoration:none;background:#fff}',
  '.msgp-att .msgp-size{color:#69758a}',
  '.msgp-empty{color:#69758a;font-style:italic}',
].join('');
```

- [ ] **Step 5: Implement `src/html/render.ts`**

```ts
import { parseMsg } from '../message/index.js';
import type { MsgAttachment, MsgMessage, RenderOptions } from '../types.js';
import { blockRemoteImages as blockRemote, sanitizeHtml } from './sanitize.js';
import { PREVIEW_CSS } from './styles.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string;
  });
}

function fmtSize(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function fmtWho(name: string, email: string | null): string {
  let h = '';
  if (name) h += '<b>' + esc(name) + '</b>';
  if (email && email !== name) h += (h ? ' ' : '') + '<span>&lt;' + esc(email) + '&gt;</span>';
  return h || '<span>—</span>';
}

function dataUri(att: MsgAttachment): string {
  return 'data:' + (att.mime || 'application/octet-stream') + ';base64,' + toBase64(att.data!);
}

function buildBody(msg: MsgMessage, options: RenderOptions): string {
  if (msg.bodyHtml) {
    let html = sanitizeHtml(msg.bodyHtml);
    if (options.inlineImages !== false) {
      for (const a of msg.attachments) {
        if (a.contentId && a.data) {
          const cid = a.contentId.replace(/^</, '').replace(/>$/, '');
          html = html.split('cid:' + cid).join(dataUri(a));
        }
      }
    }
    if (options.blockRemoteImages) html = blockRemote(html);
    return '<div class="msgp-body">' + html + '</div>';
  }
  if (msg.bodyText) {
    return '<div class="msgp-body"><pre>' + esc(msg.bodyText) + '</pre></div>';
  }
  return '<div class="msgp-body"><div class="msgp-empty">This message has no text.</div></div>';
}

function buildHead(msg: MsgMessage, options: RenderOptions): string {
  let rows = '<div class="msgp-subject">' + (esc(msg.subject) || '(no subject)') + '</div>';
  rows +=
    '<div class="msgp-row"><span class="msgp-label">From:</span><span class="msgp-who">' +
    fmtWho(msg.senderName, msg.senderEmail) +
    '</span></div>';
  const groups: Record<'to' | 'cc' | 'bcc', string[]> = { to: [], cc: [], bcc: [] };
  for (const r of msg.recipients) groups[r.type].push(fmtWho(r.name, r.email));
  const labels: Record<'to' | 'cc' | 'bcc', string> = { to: 'To:', cc: 'Cc:', bcc: 'Bcc:' };
  (['to', 'cc', 'bcc'] as const).forEach((k) => {
    if (groups[k].length)
      rows +=
        '<div class="msgp-row"><span class="msgp-label">' +
        labels[k] +
        '</span><span class="msgp-who">' +
        groups[k].join(', ') +
        '</span></div>';
  });
  if (msg.date) {
    const text = options.formatDate
      ? options.formatDate(msg.date)
      : msg.date.toLocaleString(options.locale || 'en-US');
    rows += '<div class="msgp-date">' + esc(text) + '</div>';
  }
  return '<div class="msgp-head">' + rows + '</div>';
}

function buildAttachments(msg: MsgMessage, options: RenderOptions): string {
  const visible = msg.attachments.filter((a) => !a.hidden || options.showHiddenAttachments);
  if (!visible.length) return '';
  const items = visible
    .map((a) => {
      const size = a.data ? ' <span class="msgp-size">' + fmtSize(a.data.length) + '</span>' : '';
      return '<span class="msgp-att">📎 ' + esc(a.name) + size + '</span>';
    })
    .join('');
  return '<div class="msgp-atts">' + items + '</div>';
}

/** Render a parsed message (or raw bytes) to a sanitized, self-contained HTML string. */
export function renderToHtml(
  input: MsgMessage | ArrayBuffer | Uint8Array,
  options: RenderOptions = {},
): string {
  const msg = input instanceof ArrayBuffer || input instanceof Uint8Array ? parseMsg(input) : input;
  const inner =
    '<div class="msgp">' +
    buildHead(msg, options) +
    buildBody(msg, options) +
    buildAttachments(msg, options) +
    '</div>';
  if (options.fragment) return inner;
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
    '<style>' +
    PREVIEW_CSS +
    '</style></head><body>' +
    inner +
    '</body></html>'
  );
}

/** Convenience: render straight from a File/Blob (reads the bytes for you). */
export async function renderMsgFile(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options: RenderOptions = {},
): Promise<string> {
  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    return renderToHtml(input, options);
  }
  const buf = await input.arrayBuffer();
  return renderToHtml(buf, options);
}
```

- [ ] **Step 6: Implement `src/html/index.ts`**

```ts
export { sanitizeHtml } from './sanitize.js';
export { renderToHtml, renderMsgFile } from './render.js';
export { PREVIEW_CSS } from './styles.js';
```

- [ ] **Step 7: Wire the public API in `src/index.ts`**

```ts
export * from './types.js';
export { parseMsg } from './message/index.js';
export { renderToHtml, renderMsgFile } from './html/index.js';
export { decompressRtf } from './rtf/index.js';

export const version = '0.1.0';
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/unit/render.test.ts`
Expected: PASS. Then run the whole suite: `npm test` — all unit tests green.

- [ ] **Step 9: Full gate**

Run:

```bash
npm run typecheck && npm run lint && npm run coverage && npm run build
```

Expected: typecheck clean; lint clean; coverage report shows core modules well-covered; `dist/` built with ESM/CJS/d.ts.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add HTML renderer and public API (renderToHtml, renderMsgFile)"
```

---

## Task 9: README, LICENSE, and demo page

**Files:**

- Create: `README.md`, `LICENSE`, `demo/index.html`

**Interfaces:**

- Consumes: the public API from Task 8.
- Produces: user-facing docs and a manual-verification demo. No code interfaces.

- [ ] **Step 1: Record resolved tool versions**

Run:

```bash
node -e "const p=require('./package.json');console.log(Object.entries(p.devDependencies).map(([k,v])=>k+' '+v).join('\n'))"
```

Copy the output into the README "Tooling versions" section in Step 2.

- [ ] **Step 2: Write `README.md`**

````markdown
# msg-previewer

Dependency-free TypeScript library to parse and preview Outlook `.msg` files in the browser
(and Node). Files are parsed locally — nothing is uploaded.

## Install

```bash
# From git (MVP):
npm install github:<org>/msg-previewer#v0.1.0
```

The package's `prepare` script builds `dist/` automatically on install.

## Usage

### One-liner for a file input (the common case)

```ts
import { renderMsgFile } from 'msg-previewer';

input.addEventListener('change', async () => {
  const html = await renderMsgFile(input.files[0]);
  iframe.setAttribute('sandbox', ''); // no allow-scripts — this is the security boundary
  iframe.srcdoc = html;
});
```

### Parse to structured data

```ts
import { parseMsg } from 'msg-previewer';

const msg = parseMsg(await file.arrayBuffer());
// { subject, senderName, senderEmail, date, recipients, bodyHtml, bodyText, attachments, ... }
```

### Render a parsed message

```ts
import { renderToHtml } from 'msg-previewer';
const html = renderToHtml(msg, { locale: 'uk-UA', blockRemoteImages: true });
```

## API

| Export          | Signature                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `parseMsg`      | `(input: ArrayBuffer \| Uint8Array) => MsgMessage`                                               |
| `renderToHtml`  | `(input: MsgMessage \| ArrayBuffer \| Uint8Array, options?: RenderOptions) => string`            |
| `renderMsgFile` | `(input: File \| Blob \| ArrayBuffer \| Uint8Array, options?: RenderOptions) => Promise<string>` |
| `decompressRtf` | `(bytes: Uint8Array) => Uint8Array \| null`                                                      |

`RenderOptions`: `locale`, `formatDate`, `showHiddenAttachments`, `inlineImages`,
`blockRemoteImages`, `fragment`.

## Security

`renderToHtml` output is intended to be rendered inside a **sandboxed iframe without
`allow-scripts`** — that is the real security boundary. The library additionally strips
`<script>`, `on*=` handlers, and `javascript:` URLs as defense-in-depth. Set
`blockRemoteImages: true` to neutralize external image loads.

## Scope

Parses: headers, sender, recipients (To/Cc/Bcc), date, plain-text and HTML bodies (including
HTML recovered from compressed RTF), attachments, and inline `cid:` images. Not yet
supported: embedded `.msg` attachments and exotic ANSI codepage switching.

## Tooling versions

<!-- paste the output of Step 1 here -->

## License

MIT
````

- [ ] **Step 3: Write `LICENSE`** (MIT, current year, copyright "Precoro")

Use the standard MIT license text with `Copyright (c) 2026 Precoro`.

- [ ] **Step 4: Write `demo/index.html`** (drag & drop / file picker, manual check)

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>msg-previewer demo</title>
    <style>
      body {
        font: 15px/1.5 sans-serif;
        margin: 2rem;
      }
      #drop {
        border: 2px dashed #99a;
        border-radius: 10px;
        padding: 2rem;
        text-align: center;
      }
      iframe {
        width: 100%;
        height: 70vh;
        border: 1px solid #ccc;
        margin-top: 1rem;
      }
    </style>
  </head>
  <body>
    <h1>msg-previewer demo</h1>
    <div id="drop">Drop a .msg file here, or <input type="file" id="file" accept=".msg" /></div>
    <iframe id="view" sandbox></iframe>
    <script type="module">
      import { renderMsgFile } from '../dist/index.mjs';
      const view = document.getElementById('view');
      async function show(file) {
        view.srcdoc = await renderMsgFile(file);
      }
      document.getElementById('file').addEventListener('change', (e) => show(e.target.files[0]));
      const drop = document.getElementById('drop');
      drop.addEventListener('dragover', (e) => e.preventDefault());
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) show(e.dataTransfer.files[0]);
      });
    </script>
  </body>
</html>
```

Note: the demo imports from `dist/`, so run `npm run build` first, then serve the folder
(e.g. `npx serve .`) and open `demo/index.html`.

- [ ] **Step 5: Verify the demo builds and loads**

Run:

```bash
npm run build
npx --yes serve -l 5055 . &
```

Open `http://localhost:5055/demo/index.html`, confirm the page renders and the file picker is present. Stop the server afterward.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: add README, LICENSE, and demo page"
```

---

## Task 10: Snapshot tests over real `.msg` samples

**Files:**

- Create: `test/helpers/serialize-message.ts`, `test/snapshot/message.test.ts`
- Add: `test/fixtures/*.msg` (the sample files provided by the user)

**Interfaces:**

- Consumes: `parseMsg`, `renderToHtml`; sample `.msg` files.
- Produces: committed Vitest snapshots of parsed data and rendered HTML for each sample.

**Prerequisite:** the user's sample `.msg` files are copied into `test/fixtures/`. If none are
present yet, this task is deferred; the suite must still pass (the test globs the directory
and no-ops when empty).

- [ ] **Step 1: Write the message serializer `test/helpers/serialize-message.ts`**

Summarizes attachment bytes so snapshots stay readable and deterministic.

```ts
import type { MsgMessage } from '../../src/index.js';

export function serializeMessage(msg: MsgMessage): unknown {
  return {
    subject: msg.subject,
    senderName: msg.senderName,
    senderEmail: msg.senderEmail,
    date: msg.date ? msg.date.toISOString() : null,
    recipients: msg.recipients,
    hasHtml: msg.bodyHtml != null,
    bodyText: msg.bodyText,
    attachments: msg.attachments.map((a) => ({
      name: a.name,
      mime: a.mime,
      contentId: a.contentId,
      hidden: a.hidden,
      size: a.data ? a.data.length : null,
    })),
  };
}
```

- [ ] **Step 2: Write `test/snapshot/message.test.ts`**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMsg, renderToHtml } from '../../src/index.js';
import { serializeMessage } from '../helpers/serialize-message.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

function listMsg(): string[] {
  try {
    return readdirSync(fixturesDir).filter((f) => f.toLowerCase().endsWith('.msg'));
  } catch {
    return [];
  }
}

const files = listMsg();

describe.skipIf(files.length === 0)('snapshot: real .msg samples', () => {
  for (const file of files) {
    it(`parses ${file}`, () => {
      const bytes = new Uint8Array(readFileSync(join(fixturesDir, file)));
      const msg = parseMsg(bytes);
      expect(serializeMessage(msg)).toMatchSnapshot();
    });

    it(`renders ${file}`, () => {
      const bytes = new Uint8Array(readFileSync(join(fixturesDir, file)));
      const html = renderToHtml(bytes);
      expect(html).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 3: Add sample files and run to generate snapshots**

Copy the provided samples into `test/fixtures/`, then run:

```bash
npx vitest run test/snapshot/message.test.ts
```

Expected: on first run, snapshots are written under `test/snapshot/__snapshots__/`. Inspect
them for correctness (subjects, recipients, body presence, attachment names/sizes look right).

- [ ] **Step 4: Re-run to confirm stability**

Run: `npx vitest run test/snapshot/message.test.ts`
Expected: PASS with "snapshots written: 0" — output is deterministic.

- [ ] **Step 5: Final full gate**

Run:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run coverage && npm run build
```

Expected: everything green; coverage ≥ ~90% on `cfb`, `rtf`, `encoding`, `mapi`, `html`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add snapshot coverage for real .msg samples"
```

---

## Completion checklist

- [ ] `parseMsg`, `renderToHtml`, `renderMsgFile`, `decompressRtf` exported and typed.
- [ ] Zero runtime dependencies in `package.json`.
- [ ] ESM + CJS + `.d.ts` emitted to `dist/`.
- [ ] Unit tests for cfb, encoding, rtf (decompress/de-encapsulate/to-text), mapi, message, html.
- [ ] Snapshot tests over provided samples (or cleanly skipped when none present).
- [ ] `typecheck`, `lint`, `format:check`, `coverage`, `build` all pass.
- [ ] README documents the security-via-sandboxed-iframe contract and the Precoro one-liner.
- [ ] Resolved dev-tool versions recorded in the README.
