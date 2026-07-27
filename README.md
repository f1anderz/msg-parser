# msg-previewer

Dependency-free TypeScript library to parse and preview Outlook `.msg` files in the browser
(and Node). Files are parsed locally — nothing is uploaded.

## Install

Published to **GitHub Packages** under the `@precoro` scope. Point the scope at the GitHub
registry once (project `.npmrc`), then install normally:

```ini
# .npmrc
@precoro:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @precoro/msg-previewer
```

`GITHUB_TOKEN` needs `read:packages` scope. Installs ship the prebuilt, minified `dist/`
(no source, no build step).

## Usage

### One-liner for a file input (the common case)

```ts
import { renderMsgFile } from '@precoro/msg-previewer';

input.addEventListener('change', async () => {
  const html = await renderMsgFile(input.files[0]);
  iframe.setAttribute('sandbox', ''); // no allow-scripts — this is the security boundary
  iframe.srcdoc = html;
});
```

### Parse to structured data

```ts
import { parseMsg } from '@precoro/msg-previewer';

const msg = parseMsg(await file.arrayBuffer());
// { subject, senderName, senderEmail, date, recipients, bodyHtml, bodyText, attachments, ... }
```

### Render a parsed message

```ts
import { renderToHtml } from '@precoro/msg-previewer';
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

`parseMsg` (and therefore `renderToHtml`/`renderMsgFile`) throws `InvalidMsgError` when given a
buffer that isn't a valid `.msg` (missing OLE Compound File signature) or is otherwise corrupt.

`renderMsgFile`'s `File`/`Blob` overload types require the DOM lib (or `@types/node`'s DOM-ish
globals) to be available in the consumer's TypeScript config; browser app configs already include
this by default.

## Security

`renderToHtml` output is intended to be rendered inside a **sandboxed iframe without
`allow-scripts`** — that is the real security boundary. The library additionally strips
`<script>`, `on*=` handlers, and `javascript:` URLs as defense-in-depth. Set
`blockRemoteImages: true` to neutralize external `<img>` sources only — it is not a
comprehensive remote-resource blocker and does not stop CSS `url(...)`, `<link>`, or
`@import` loads.

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
