# msg-parser

TypeScript library to parse Outlook `.msg` files to HTML string. Files are parsed locally — nothing is uploaded. Runs in the browser, Node, and React Native — no DOM required.

## Install

Published to **GitHub Packages** under the `@f1anderz` scope. Point the scope at the GitHub
registry once (project `.npmrc`), then install normally:

```ini
# .npmrc
@f1anderz:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @f1anderz/msg-parser
```

`GITHUB_TOKEN` needs `read:packages` scope. Installs ship the prebuilt, minified `dist/`
(no source, no build step).

## Usage

### One-liner for a file input (the common case)

```ts
import { renderMsgFile } from '@f1anderz/msg-parser';

input.addEventListener('change', async () => {
  const html = await renderMsgFile(input.files[0]);
  iframe.setAttribute('sandbox', ''); // no allow-scripts — this is the security boundary
  iframe.srcdoc = html;
});
```

### Parse to structured data

```ts
import { parseMsg } from '@f1anderz/msg-parser';

const msg = parseMsg(await file.arrayBuffer());
// { subject, senderName, senderEmail, date, recipients, bodyHtml, bodyText, attachments, ... }
```

### Render a parsed message

```ts
import { renderToHtml } from '@f1anderz/msg-parser';
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
`blockRemoteImages`, `fragment`, `sanitize`.

`sanitize?: (html: string) => string` replaces the built-in sanitizer. It receives the raw body
HTML before `cid:` substitution, and fully overrides sanitization — `blockRemoteImages` included.

`parseMsg` (and therefore `renderToHtml`/`renderMsgFile`) throws `InvalidMsgError` when given a
buffer that isn't a valid `.msg` (missing OLE Compound File signature) or is otherwise corrupt.

`renderMsgFile`'s `File`/`Blob` overload types require the DOM lib (or `@types/node`'s DOM-ish
globals) to be available in the consumer's TypeScript config; browser app configs already include
this by default.

## Security

`renderToHtml` output is intended to be rendered inside a **sandboxed iframe without
`allow-scripts`** — that is the real security boundary. In React Native, the equivalent is
`react-native-webview` with `javaScriptEnabled={false}`. If you render this HTML in a WebView
with JavaScript enabled, the sanitizer becomes your only boundary rather than defense-in-depth.

As defense-in-depth, message HTML is sanitized with [`xss`](https://github.com/leizongmin/js-xss)
against an allowlist tuned for email: `<script>`, `<iframe>`, `<form>`, `<svg>`, `on*=` handlers,
`javascript:` URLs, and CSS `expression()`/`url(javascript:)` are removed, while the tables,
inline styles, `class` attributes and `<style>` blocks real messages depend on are preserved.
Sanitization needs no DOM, so it behaves identically in the browser, Node, and React Native.

Set `blockRemoteImages: true` to neutralize remote resources: http(s) and protocol-relative URLs
in `src`, `srcset`, `background`, and `poster` attributes, and in CSS `url(...)` inside inline
`style` attributes. It does **not** reach stylesheet contents inside `<style>` blocks, nor
`<link>` or `@import` — pass your own `sanitize` if you need that.

## Scope

Parses: headers, sender, recipients (To/Cc/Bcc), date, plain-text and HTML bodies (including
HTML recovered from compressed RTF), attachments, and inline `cid:` images. Not yet
supported: embedded `.msg` attachments and exotic ANSI codepage switching.

## Tooling versions

```
@eslint/js 10.0.1
@vitest/coverage-v8 4.1.10
eslint 10.7.0
prettier 3.9.6
tsup 8.5.1
typescript 5.9.3
typescript-eslint 8.65.0
vitest 4.1.10
```

> **Note on the `typescript` pin:** `typescript` is pinned to `5.9.3` rather than the latest
> `7.x` line because TypeScript 7.x is not yet compatible with `typescript-eslint`'s peer
> version range and broke `tsup`'s `.d.ts` build. Re-evaluate this pin once `typescript-eslint`
> and `tsup` publish support for TypeScript 7.

## License

MIT

# msg-parser
