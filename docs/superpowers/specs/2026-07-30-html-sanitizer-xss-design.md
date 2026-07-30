# Replace hand-written HTML sanitization with `xss` (js-xss)

**Date:** 2026-07-30
**Status:** approved, pending implementation plan

## Goal

Replace the three hand-written regexes in `src/html/sanitize.ts` with a real allowlist-based
sanitizer, without adding a DOM dependency. The library must keep running unchanged in three
environments: browser, Node (vitest snapshot suite), and **React Native**.

## Why not DOMPurify

DOMPurify needs a live DOM. In Node that means `jsdom` (~10 MB); in React Native there is no DOM
at all and no viable shim. DOMPurify is therefore rejected on capability grounds, not weight.
`isomorphic-dompurify` and `linkedom` are the same problem in different packaging.

The native `Element.setHTML()` / Sanitizer API is also rejected: Firefox 148 shipped it in
February 2026 and Chromium followed, but Safari has not implemented it and it is not Baseline.
It is unavailable in React Native regardless.

## Decision

Use **`xss` (js-xss) 1.0.15** as a real npm `dependency`.

- Pure JS, no DOM, no Node built-ins — works in browser, Node, and React Native/Metro.
- Sync `string -> string`, matching the existing `sanitizeHtml` signature and `renderToHtml`'s
  synchronous contract.
- 145 KB unpacked, 2 deps: `cssfilter` (used) and `commander` (CLI entry only, never bundled into
  an app).

Shipped as a real dependency rather than inlined via tsup `noExternal`, so consumers can apply
`npm overrides` / audit fixes themselves if a CVE lands in a security-critical dependency. The
README's "dependency-free" claim is dropped.

Rejected alternatives: `sanitize-html` (7 direct deps, `postcss`/`nanoid` have needed Metro
polyfills), `ultrahtml` (zero deps but a much thinner security track record), and hardening the
regexes in place.

## What xss gives us for free

Verified against xss 1.0.15's `lib/default.js` and by prototype:

- Default `safeAttrValue` already blocks `javascript:` in `href`/`src` and `url()` in `style`.
  Both existing regexes are covered by defaults; no custom hooks needed for them.
- `style` attribute values are routed through `cssfilter`, whose default allowlist covers 339
  properties including the `background-*`, `border-*`, `font-*`, `margin` and `padding` families
  that email depends on. `expression()` is stripped.
- With `stripIgnoreTag: true`, Outlook namespace tags (`<o:p>`, `<v:shape>`) are removed while
  their text content is preserved — better than the default behavior, which escapes them into
  visible `&lt;o:p&gt;` text.
- HTML comments, including MSO conditional comments (`<!--[if gte mso 9]>`), are removed entirely.

## Two constraints found while prototyping

**`cid:` must be preserved explicitly.** xss's default `safeAttrValue` allowlists `http(s)`,
`mailto:`, `tel:`, `data:image/`, `ftp://`, `./`, `../`, `#` and `/` for `href`/`src` — but not
`cid:`. Since `renderToHtml` substitutes `cid:` references *after* sanitizing, the default would
silently break every inline image. The custom `safeAttrValue` therefore short-circuits `src`
values starting with `cid:`, passing them through `friendlyAttrValue`/`escapeAttrValue` only.
`data:image/` is allowed by default, so the generated data URIs survive.

Sanitize-before-substitution is kept deliberately: it preserves the existing `buildBody` order and
keeps megabytes of base64 out of the parser, which matters on mobile.

**`xss` must be consumed via its default export.** It is CommonJS and attaches most exports in a
dynamic `for..in` loop, so Node's CJS lexer cannot expose them as ESM named imports —
`import { getDefaultWhiteList } from 'xss'` throws `SyntaxError: Named export not found` at
runtime. Only `FilterXSS` and `filterXSS` are statically detectable. The default export is the
whole module object at runtime, though its published type is narrowed to `filterXSS`, so it needs
one documented cast. Type-only named imports are safe because types are erased.

## The actual work: an email-tuned allowlist

xss's default allowlist targets user comments, not email. Out of the box it permits **no `style`
attribute on any tag**, no `class`, no `id`, no `bgcolor`/`cellpadding`/`cellspacing`, and it drops
`<style>` elements. Dropped in unmodified it would visibly wreck most real emails.

`src/html/sanitize.ts` builds one module-level `FilterXSS` instance configured with:

- Default allowlist extended with a global attribute set — `style`, `class`, `id`, `align`, `dir`,
  `title`, `lang` — applied to every allowed tag.
- Table tags (`table`, `td`, `th`, `tr`, `tbody`, `thead`, `tfoot`) additionally allow `bgcolor`,
  `background`, `cellpadding`, `cellspacing`, `width`, `height`, `nowrap`.
- `img` additionally allows `srcset`, `border`, `hspace`, `vspace`.
- `style` added to the tag allowlist (see below). `body` allowed with `bgcolor`.
- `css` left at cssfilter's default.
- `stripIgnoreTag: true`; `stripIgnoreTagBody: ['script']`.

### `<style>` elements

`<style>` stays allowed, preserving today's behavior — many Outlook messages carry their CSS in a
`<style>` block, and dropping it is a visible fidelity regression. Note that if `style` were *not*
allowlisted, xss would strip the tag but leak its contents as visible text, so allowlisting it is
also the safer of the two available shapes.

Consequence: stylesheet **contents** remain unfiltered. `cssfilter` only processes inline
declaration lists, so `blockRemoteImages` cannot reach `url()` inside a `<style>` block. This is
already disclosed in the README and the disclosure stays.

### `blockRemoteImages`

Reimplemented as a `safeAttrValue` wrapper rather than a second regex pass over the output. It
neutralizes `http(s)` URLs in `src`, `srcset`, `background`, and `poster` attributes, and in
`background-image` within inline `style`. This is strictly more coverage than today's
`<img src>`-only regex.

The exported `blockRemoteImages(html)` helper is removed; the behavior moves into the sanitizer
configuration. It was never part of the documented public API — `src/html/index.ts` exports only
`sanitizeHtml`, `renderToHtml`, `renderMsgFile`, and `PREVIEW_CSS`.

## API changes

`sanitizeHtml(html: string) => string` remains exported with an identical signature, now backed by
xss. Existing consumers and `test/unit/render.test.ts` are unaffected.

New in `RenderOptions` (`src/types.ts`):

```ts
/** Replace the built-in sanitizer. Fully overrides sanitization, including blockRemoteImages. */
sanitize?: (html: string) => string;
```

`buildBody` in `src/html/render.ts` becomes:

```ts
const clean = options.sanitize
  ? options.sanitize(msg.bodyHtml)
  : sanitizeBody(msg.bodyHtml, { blockRemoteImages: options.blockRemoteImages === true });
```

A caller-supplied `sanitize` fully replaces the built-in behavior, `blockRemoteImages` included —
a custom sanitizer owns its own allowlist and remote-resource policy. This is documented on the
option and in the README.

`sanitize` runs on `msg.bodyHtml` **before** `cid:` inline-image substitution, so the `data:` URIs
this library generates are not subject to a consumer sanitizer's URI policy. Header, attachment
name, and plain-text-body output continue to use `esc()`; they are escaped, never sanitized, and
are out of scope.

## Security model

Unchanged in substance: the real boundary is the embedding context, and sanitization is
defense-in-depth. In a browser that boundary is a sandboxed iframe without `allow-scripts`. In
React Native it is `react-native-webview` with `javaScriptEnabled={false}`. If the mobile app
renders this HTML in a WebView with JS enabled, the sanitizer becomes the only boundary rather
than defense-in-depth — a materially different risk posture.

The README security section is updated for the sanitizer change and the dropped dependency-free
claim. A dedicated React Native usage section is out of scope for this change.

## Testing

Unit tests in `test/unit/render.test.ts`, extended from the prototype cases that were verified
against the real library:

- Neutralized: `onclick` handlers, `javascript:` in `href`, `url(javascript:)` and `expression()`
  in inline `style`, `<script>`, `<iframe>`, `<form>`, `<svg><animate onbegin>`, and the
  `<noscript><p title="</noscript><img onerror>">` mXSS case.
- Preserved: `<table cellpadding cellspacing width>` with `<td bgcolor>`, `class` attributes,
  inline `style` declarations, `<style>` blocks, and `<o:p>` stripped without leaking text.
- The existing benign-URL test (`href="http://example.com/onclick=1"` must survive) is kept.
- `blockRemoteImages`: remote `src`, `srcset`, `background`, `poster`, and inline
  `background-image` are neutralized, including protocol-relative `//host` URLs; `data:` and `cid:`
  URIs are not.
- `options.sanitize` is called and its output used verbatim.

**Rendering-fidelity check.** The `test/fixtures/msg-samples/` corpus is the safety net. Render
every fixture before and after the change and diff the output. Churn is expected; each diff is
reviewed as a potential fidelity regression and the allowlist tuned until the remaining diffs are
all intended. `test/snapshot/__snapshots__/message.test.ts.snap` is regenerated only after that
review, not as a first step.

Existing gates must pass: `npm run typecheck`, `npm run lint`, `npm run test`.

## Out of scope

- A React Native usage section in the README.
- Exposing the xss allowlist for consumer extension. `options.sanitize` covers the escape hatch.
- Filtering `<style>` block contents, `<link>`, or `@import` beyond what the tag allowlist does.
