# msg-previewer — Design

**Date:** 2026-07-22
**Status:** Approved (design phase)

## 1. Purpose

A standalone, dependency-free TypeScript library for parsing and previewing Outlook
`.msg` files in the browser (and Node). It parses the OLE Compound File format locally —
files are never uploaded anywhere — and produces both a structured data object and a
sanitized, self-contained HTML string suitable for rendering inside a sandboxed iframe.

The first consumer is the Precoro frontend (Vue), which will install the package directly
from git for the MVP and embed the rendered HTML in a sandboxed `<iframe srcdoc>`.

## 2. Goals & non-goals

### Goals (MVP)

- Parse the OLE Compound File Binary (CFB) container: header, FAT, mini-FAT, DIFAT,
  directory tree, large and small streams.
- Extract core message fields: subject, sender (name + SMTP), date, transport headers,
  recipients (To/Cc/Bcc).
- Extract message bodies: plain text, direct HTML, and HTML recovered from **compressed
  RTF** (LZFu decompression + `\fromhtml` de-encapsulation per MS-OXRTFEX). Many real
  Outlook messages store the HTML body **only** inside compressed RTF, so this is required
  for a faithful preview.
- Extract attachments (name, mime, bytes) and inline `cid:` images.
- Produce a sanitized, **self-contained** HTML preview string with inline images embedded
  as `data:` base64 URIs.
- Zero runtime dependencies. Ship ESM + CJS + type declarations.
- Prettier + ESLint enforced. Vitest unit + snapshot coverage.

### Non-goals (deferred, not MVP)

- Recursively parsing embedded `.msg` attachments.
- Exotic ANSI codepage switching (Shift-JIS, GBK, EUC-KR, KOI8, per-`\fcharset` switching).
  UTF-16 Unicode strings and a single sensible default codepage (windows-1252, plus
  detection of the message codepage property when present) **are** handled.
- Editing or creating `.msg` files (read-only).
- Named/custom MAPI properties.
- A framework component. The library stays framework-agnostic; Precoro wraps it.

## 3. Public API

Four exports from the package root:

```ts
// Parse bytes into a structured message object.
function parseMsg(input: ArrayBuffer | Uint8Array): MsgMessage;

// Render a parsed message (or raw bytes) to a self-contained, sanitized HTML document.
function renderToHtml(
  input: MsgMessage | ArrayBuffer | Uint8Array,
  options?: RenderOptions,
): string;

// Convenience one-liner for consumers holding a File/Blob (reads the bytes for you).
// Enables: iframe.srcdoc = await renderMsgFile(file)
function renderMsgFile(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options?: RenderOptions,
): Promise<string>;

// Low-level: decompress a compressed-RTF byte stream (LZFu / MELA). Exposed for advanced use.
function decompressRtf(bytes: Uint8Array): Uint8Array | null;
```

### Types

```ts
interface MsgMessage {
  subject: string;
  senderName: string;
  senderEmail: string | null;
  date: Date | null;
  headers: string | null; // raw transport headers
  recipients: MsgRecipient[];
  bodyHtml: string | null; // direct or de-encapsulated from RTF
  bodyText: string | null;
  bodyRtf: Uint8Array | null; // decompressed RTF, when present
  attachments: MsgAttachment[];
}

interface MsgRecipient {
  name: string;
  email: string | null;
  type: 'to' | 'cc' | 'bcc';
}

interface MsgAttachment {
  name: string;
  mime: string | null;
  contentId: string | null; // for inline cid: images
  hidden: boolean; // true for inline images
  data: Uint8Array | null;
  // embedded?: MsgMessage | null;  // reserved for post-MVP embedded .msg support
}

interface RenderOptions {
  locale?: string; // date formatting locale; default 'en-US'
  formatDate?: (d: Date) => string; // overrides locale-based formatting
  showHiddenAttachments?: boolean; // list inline/hidden attachments too; default false
  inlineImages?: boolean; // embed cid: images as data: URIs; default true
  blockRemoteImages?: boolean; // neutralize external http(s) image src; default false
  fragment?: boolean; // return inner HTML fragment instead of a full document; default false
}
```

## 4. Architecture

Small, single-purpose modules communicating through plain data. Each is unit-testable in
isolation with no DOM.

```
src/
  cfb/
    cfb.ts          Cfb class: parse header, read FAT/mini-FAT/DIFAT, directory tree,
                    readStream(entry), children(index)
    index.ts
  encoding/
    codepage.ts     codepage number -> TextDecoder label map
    decode.ts       decodeBytes(label), decodeUtf16le, FILETIME -> Date
    index.ts
  rtf/
    decompress.ts   decompressRtf (LZFu + MELA)
    deencapsulate.ts deencapsulateHtml (\fromhtml, MS-OXRTFEX)
    to-text.ts      rtfToText fallback
    index.ts
  mapi/
    tags.ts         property-tag id constants (subject, sender, body, etc.)
    props.ts        substorage prop extraction, __properties_version1.0 fixed props,
                    typed getters, message-codepage detection
    index.ts
  message/
    parse.ts        parseMsg(): orchestrate cfb + mapi + rtf + encoding -> MsgMessage
    index.ts
  html/
    sanitize.ts     strip <script>, on*= handlers, javascript: URIs
    render.ts       renderToHtml(): assemble header chrome + body + attachments,
                    inline cid images as data: URIs
    styles.ts       scoped default CSS string
    index.ts
  types.ts          public interfaces
  index.ts          public exports (parseMsg, renderToHtml, renderMsgFile, decompressRtf)
```

**Data flow:** `bytes → Cfb → parseStorageAsMessage (mapi + rtf + encoding) → MsgMessage → renderToHtml → string`.

`renderMsgFile` normalizes its input to `Uint8Array` (via `Blob.arrayBuffer()` when given a
`File`/`Blob`) and delegates to `renderToHtml`.

## 5. Rendering decisions

- **Self-contained output.** `renderToHtml` returns a self-contained HTML document
  (`<!doctype>` + scoped `<style>` + header chrome + email body + attachments list).
  Inline `cid:` images are embedded as `data:` base64 URIs (not browser-only `blob:` URLs),
  so output is framework-free, Node-testable, and deterministic for snapshots. With
  `fragment: true`, only the inner fragment is returned.
- **Body isolation (MVP).** The email body is placed in a scoped container within the same
  document, relying on sanitization. Minor cosmetic CSS bleed from the email body into the
  header chrome is an accepted MVP trade-off. Strict isolation via a nested iframe is a
  documented future enhancement.
- **Security boundary.** Regex sanitization (removing `<script>`, `on*=` handlers, and
  `javascript:` URLs) is defense-in-depth only. The real boundary is the consumer rendering
  the string inside a sandboxed iframe (`sandbox`, no `allow-scripts`). This contract is
  documented in the README. Remote images load only if the email references them; set
  `blockRemoteImages: true` to neutralize external `http(s)` image sources.

## 6. Error handling

- `parseMsg` throws `InvalidMsgError` (a named subclass of `Error`) when the OLE signature
  is missing or the container is unreadable. Messages are in English.
- Body and RTF processing is best-effort: LZFu decompression, HTML de-encapsulation, and
  RTF-to-text failures are caught and fall back gracefully (HTML → text → empty), never
  throwing out of `parseMsg`.
- Corrupt FAT chains are guarded against cycles (bounded traversal) as in the reference.

## 7. Tooling & packaging

- **Language:** TypeScript, `strict: true`, target ES2020, `moduleResolution: bundler`.
- **Runtime deps:** none. Relies only on universal `TextDecoder`, `ArrayBuffer`,
  `Uint8Array`, `Blob` (Node 18+ and browsers).
- **Test:** Vitest (unit + snapshot), `@vitest/coverage-v8`.
- **Build:** tsup (esbuild) → `dist/` with ESM (`.mjs`), CJS (`.cjs`), and `.d.ts`.
- **Lint/format:** ESLint (typescript-eslint flat config) + Prettier, with a check script.
- **Versions:** every dev tool installed at **latest stable** (`@latest`) at setup time.
  Resolved versions are recorded in the README after install rather than guessed here.
- **package.json highlights:** `"type": "module"`, `exports` map (`import`/`require`/`types`),
  `files: ["dist"]`, `sideEffects: false`, `engines.node >= 18`, `license: MIT`.
- **Git install support:** a `prepare` script runs `tsup`, so `npm install <git-url>#<tag>`
  builds `dist/` automatically without committing build artifacts. `dist/` is gitignored.
- **Scripts:** `build`, `dev`, `test`, `test:watch`, `coverage`, `lint`, `lint:fix`,
  `format`, `format:check`, `typecheck`, `prepare`, `prepublishOnly`.

## 8. Testing strategy

- **Unit (implemented from the start, no sample files needed):**
  - CFB: header parsing and FAT-chain following on small hand-crafted buffers; bad-signature
    rejection.
  - `decompressRtf`: a known LZFu input → expected output vector; MELA (uncompressed) path.
  - `deencapsulateHtml`: a minimal `\fromhtml` RTF snippet → expected HTML.
  - encoding: `decodeUtf16le`, `decodeBytes`, FILETIME → Date conversion.
  - sanitize: `<script>`, `on*=`, and `javascript:` are stripped; benign markup preserved.
  - render: header rows, attachment list, `cid:` → `data:` inlining, `fragment` option.
  - codepage map lookups.
- **Snapshot (added when sample `.msg` files are provided):**
  - For each `test/fixtures/*.msg`: snapshot the `MsgMessage` (attachment `data` summarized
    as `{ name, mime, size }` via a custom serializer, not raw bytes) and snapshot the
    `renderToHtml` output.
- **Coverage target:** ~90% lines/branches on `cfb`, `rtf`, `encoding`, `mapi`, `html`.
- Snapshots are deterministic: dates come from file content; no wall-clock or randomness in
  output.

## 9. Repository layout

```
msg-previewer/
  src/                  (as in §4)
  test/
    unit/               *.test.ts
    fixtures/           sample .msg files (added when provided) + snapshots
  docs/superpowers/specs/2026-07-22-msg-previewer-design.md
  demo/                 optional static demo page (drag & drop) for manual verification
  README.md
  LICENSE               MIT
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  eslint.config.js
  .prettierrc
  .gitignore
```

## 10. Milestones

1. Repo scaffold: package.json, tsconfig, tsup, vitest, eslint, prettier, .gitignore.
2. `encoding` + `cfb` modules with unit tests.
3. `rtf` module (decompress, de-encapsulate, to-text) with unit tests.
4. `mapi` + `message` modules → `parseMsg` with unit tests.
5. `html` module → `renderToHtml` / `renderMsgFile` with unit tests.
6. Public `index.ts`, README (usage, security contract, Precoro one-liner), demo page.
7. Snapshot tests over provided sample `.msg` files.
8. Verify: build, typecheck, lint, format, full test + coverage all green.
