# xss Sanitizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three hand-written sanitization regexes in `src/html/sanitize.ts` with `xss` (js-xss), an allowlist-based sanitizer that needs no DOM, while preserving Outlook rendering fidelity.

**Architecture:** One module-level pair of `FilterXSS` instances in `src/html/sanitize.ts` — one permissive, one that also neutralizes remote resources — configured with an email-tuned allowlist derived from xss's default. `render.ts` calls `sanitizeBody(html, { blockRemoteImages })` instead of chaining two regex passes. A new `RenderOptions.sanitize` lets consumers substitute their own sanitizer.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), tsup, vitest, eslint, `xss@^1.0.15`.

**Spec:** [2026-07-30-html-sanitizer-xss-design.md](../specs/2026-07-30-html-sanitizer-xss-design.md)

## Global Constraints

- **No DOM.** The library must run in browser, Node, and React Native. Never import `jsdom`, `linkedom`, DOMPurify, or reference `window`/`document`.
- **`xss` must be imported via its default export**, not named imports. `xss` is CommonJS and attaches most exports in a dynamic `for..in` loop, so Node's CJS lexer cannot see them: `import { getDefaultWhiteList } from 'xss'` throws `SyntaxError: Named export 'getDefaultWhiteList' not found` at runtime. Only `FilterXSS` and `filterXSS` are statically detectable. Type-only named imports (`import type { ... } from 'xss'`) are safe because types are erased.
- **`sanitizeHtml(html: string) => string`** stays exported from `src/html/index.js` with an unchanged signature.
- **`cid:` URIs in `src` must survive sanitization.** xss's default `href`/`src` scheme allowlist permits `http(s)`, `mailto:`, `tel:`, `data:image/`, `ftp://`, `./`, `../`, `#`, `/` — but **not** `cid:`. `renderToHtml` substitutes `cid:` references *after* sanitizing, so dropping them silently breaks all inline images.
- **Sanitize before `cid:` substitution.** Preserves the existing order in `buildBody` and keeps megabytes of base64 data URIs out of the parser — a measurable win on mobile.
- `npm run typecheck`, `npm run lint`, and `npm run test` must pass before every commit.
- `package-lock.json`, `test/fixtures/msg-samples/`, and `test/snapshot/__snapshots__/message.test.ts.snap` are gitignored. Never `git add` them.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/html/sanitize.ts` | **Rewritten.** Email-tuned allowlist, the two `FilterXSS` instances, `sanitizeHtml`, `sanitizeBody`. Old regex helpers deleted. |
| `src/html/render.ts` | **Modified.** `buildBody` calls `sanitizeBody` or `options.sanitize`. |
| `src/html/index.ts` | Unchanged — already exports only `sanitizeHtml`, `renderToHtml`, `renderMsgFile`, `PREVIEW_CSS`. |
| `src/types.ts` | **Modified.** Adds `RenderOptions.sanitize`. |
| `test/unit/render.test.ts` | **Modified.** Sanitizer XSS/fidelity/remote-blocking/override tests. |
| `README.md` | **Modified.** Security section, dependency claim, `RenderOptions` list. |
| `package.json` | **Modified.** Adds the `xss` dependency. |

---

## Task 1: Replace `sanitizeHtml` with an xss-backed sanitizer

Adds the dependency and rewrites `sanitizeHtml`. The old `blockRemoteImages` regex helper is left in place so `render.ts` keeps compiling; Task 2 removes it.

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/html/sanitize.ts` (full rewrite of `sanitizeHtml`; keep `blockRemoteImages` as-is)
- Test: `test/unit/render.test.ts:33-48` (replace the `sanitizeHtml` describe block)

**Interfaces:**
- Produces: `sanitizeHtml(html: string): string` — unchanged signature, xss-backed.
- Produces (internal, used by Task 2): `makeSafeAttrValue(blockRemote: boolean): SafeAttrValueHandler`, `buildWhiteList(): IWhiteList`, and the `BASE` options object.

- [ ] **Step 1: Install the dependency**

```bash
npm install xss@^1.0.15
```

Confirm `package.json` gained a `dependencies` block containing `"xss": "^1.0.15"`. Do not commit `package-lock.json` — it is gitignored.

- [ ] **Step 2: Write the failing tests**

Replace the entire `describe('sanitizeHtml', ...)` block at `test/unit/render.test.ts:33-48` with:

```ts
describe('sanitizeHtml', () => {
  it('strips scripts, event handlers and javascript: URIs', () => {
    const dirty = `<div onclick="x()"><script>alert(1)</script><a href="javascript:evil()">y</a></div>`;
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
  });

  it('does not corrupt benign URLs containing /on<word>= path/query segments', () => {
    const html = '<a href="http://example.com/onclick=1">link</a><p>after</p>';
    const out = sanitizeHtml(html);
    expect(out).toContain('href="http://example.com/onclick=1"');
    expect(out).toContain('<p>after</p>');
  });

  it('drops tags outside the allowlist entirely', () => {
    expect(sanitizeHtml('<iframe src="http://e.com"></iframe>')).toBe('');
    expect(sanitizeHtml('<form action="http://e.com"><input name="p"></form>')).toBe('');
    expect(sanitizeHtml('<svg><animate onbegin="alert(1)" attributeName="x"></svg>')).toBe('');
  });

  it('removes script bodies rather than leaking them as text', () => {
    expect(sanitizeHtml('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('neutralizes dangerous CSS in inline style attributes', () => {
    expect(sanitizeHtml('<div style="background-image:url(javascript:evil())">x</div>')).not.toContain(
      'javascript:',
    );
    expect(sanitizeHtml('<div style="width:expression(alert(1))">x</div>')).not.toContain(
      'expression',
    );
  });

  it('escapes the noscript title mXSS payload instead of reviving it', () => {
    const out = sanitizeHtml('<noscript><p title="</noscript><img src=x onerror=alert(1)>">');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
  });

  it('preserves the table markup and inline styles real email depends on', () => {
    const html =
      '<table cellpadding="0" cellspacing="0" width="600"><tr>' +
      '<td bgcolor="#f4f4f4" style="padding:8px"><p class="b">Hi</p></td></tr></table>';
    const out = sanitizeHtml(html);
    expect(out).toContain('cellpadding="0"');
    expect(out).toContain('cellspacing="0"');
    expect(out).toContain('width="600"');
    expect(out).toContain('bgcolor="#f4f4f4"');
    expect(out).toContain('padding:8px');
    expect(out).toContain('class="b"');
  });

  it('keeps <style> blocks, which Outlook uses for message CSS', () => {
    expect(sanitizeHtml('<style>.b{font-weight:bold}</style><p class="b">x</p>')).toContain(
      '<style>.b{font-weight:bold}</style>',
    );
  });

  it('strips Outlook namespace tags and MSO conditional comments without leaking text', () => {
    expect(sanitizeHtml('<p>a<o:p></o:p>b</p>')).toBe('<p>ab</p>');
    expect(sanitizeHtml('<!--[if gte mso 9]><xml>junk</xml><![endif]--><p>hi</p>')).toBe('<p>hi</p>');
    expect(sanitizeHtml('<head><title>Msg</title></head><p>hi</p>')).not.toContain('Msg');
  });

  it('preserves cid: image references for later inlining', () => {
    expect(sanitizeHtml('<img src="cid:img1">')).toContain('cid:img1');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/unit/render.test.ts -t sanitizeHtml`

Expected: FAIL. The new cases fail against the regex implementation — `<iframe>`/`<form>`/`<svg>` survive, `<style>`/`<o:p>` assertions differ, and `expression()` is untouched.

- [ ] **Step 4: Rewrite `src/html/sanitize.ts`**

Replace the file's `sanitizeHtml` with the following, keeping the existing `blockRemoteImages` export at the bottom untouched for now:

```ts
import xssDefault from 'xss';
import type { FilterXSS, IFilterXSSOptions, IWhiteList, SafeAttrValueHandler } from 'xss';

/**
 * `xss` is CommonJS and attaches most of its exports in a dynamic loop, so Node's
 * CJS lexer cannot expose them as ESM named imports — `getDefaultWhiteList` and
 * `safeAttrValue` resolve to `undefined` that way. The default export is the whole
 * module object at runtime, though its published type is narrowed to `filterXSS`.
 */
interface XssModule {
  FilterXSS: new (options?: IFilterXSSOptions) => FilterXSS;
  getDefaultWhiteList: () => IWhiteList;
  safeAttrValue: SafeAttrValueHandler;
  friendlyAttrValue: (value: string) => string;
  escapeAttrValue: (value: string) => string;
}
const {
  FilterXSS: Filter,
  getDefaultWhiteList,
  safeAttrValue: defaultSafeAttrValue,
  friendlyAttrValue,
  escapeAttrValue,
} = xssDefault as unknown as XssModule;

const GLOBAL_ATTRS = ['style', 'class', 'id', 'align', 'dir', 'title', 'lang'];
const TABLE_TAGS = ['table', 'td', 'th', 'tr', 'tbody', 'thead', 'tfoot'];
const TABLE_ATTRS = [
  'bgcolor',
  'background',
  'cellpadding',
  'cellspacing',
  'width',
  'height',
  'nowrap',
];
const IMG_ATTRS = ['srcset', 'border', 'hspace', 'vspace'];
const REMOTE_ATTRS = new Set(['src', 'srcset', 'background', 'poster']);
const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
const REMOTE_CSS_URL = /url\(\s*['"]?\s*(?:https?:)?\/\//gi;
const CID_URI = /^cid:/i;

const uniq = (a: string[]): string[] => [...new Set(a)];

/**
 * xss ships an allowlist tuned for user comments: no `style`, `class` or `bgcolor`
 * anywhere, and no `<style>` element. Email markup needs all of them.
 */
function buildWhiteList(): IWhiteList {
  const wl = getDefaultWhiteList();
  for (const tag of Object.keys(wl)) wl[tag] = uniq([...(wl[tag] ?? []), ...GLOBAL_ATTRS]);
  for (const tag of TABLE_TAGS) wl[tag] = uniq([...(wl[tag] ?? []), ...TABLE_ATTRS]);
  wl.img = uniq([...(wl.img ?? []), ...IMG_ATTRS]);
  wl.style = [];
  wl.body = uniq([...GLOBAL_ATTRS, 'bgcolor']);
  return wl;
}

function makeSafeAttrValue(blockRemote: boolean): SafeAttrValueHandler {
  return (tag, name, value, cssFilter) => {
    const attr = name.toLowerCase();
    // xss's scheme allowlist for `src` has no `cid:`, but renderToHtml substitutes
    // `cid:` references with data: URIs *after* sanitizing, so they must survive.
    if (attr === 'src') {
      const raw = friendlyAttrValue(value).trim();
      if (CID_URI.test(raw)) return escapeAttrValue(raw);
    }
    const clean = defaultSafeAttrValue(tag, name, value, cssFilter);
    if (!blockRemote || !clean) return clean;
    if (REMOTE_ATTRS.has(attr)) return REMOTE_URL.test(clean) ? 'blocked:' : clean;
    if (attr === 'style') return clean.replace(REMOTE_CSS_URL, 'url(blocked://');
    return clean;
  };
}

const BASE: IFilterXSSOptions = {
  whiteList: buildWhiteList(),
  // Strip non-allowlisted tags rather than escaping them, so Outlook's `<o:p>` and
  // `<v:shape>` vanish instead of becoming visible `&lt;o:p&gt;` text.
  stripIgnoreTag: true,
  // These tags take their contents with them. `style` is deliberately absent — it is
  // allowlisted, so its CSS is preserved.
  stripIgnoreTagBody: ['script', 'title', 'xml'],
};

const permissive = new Filter({ ...BASE, safeAttrValue: makeSafeAttrValue(false) });
const blocking = new Filter({ ...BASE, safeAttrValue: makeSafeAttrValue(true) });

/** Defense-in-depth HTML sanitization. The primary boundary is the consumer's sandboxed iframe. */
export function sanitizeHtml(html: string): string {
  return permissive.process(html);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit/render.test.ts -t sanitizeHtml`
Expected: PASS, all 10 cases.

- [ ] **Step 6: Verify typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean. If eslint objects to `as unknown as XssModule`, keep the cast and add a narrowly-scoped disable comment on that line only — the cast is required, per Global Constraints.

- [ ] **Step 7: Run the unit suite**

Run: `npx vitest run test/unit`
Expected: PASS. `renderToHtml` tests still pass because `sanitizeHtml` preserves `cid:` and the `blockRemoteImages` regex is still wired up.

- [ ] **Step 8: Commit**

```bash
git add package.json src/html/sanitize.ts test/unit/render.test.ts
git commit -m "feat: sanitize message HTML with xss instead of hand-written regexes"
```

---

## Task 2: Move remote-resource blocking into the sanitizer

**Files:**
- Modify: `src/html/sanitize.ts` (add `sanitizeBody`, delete the `blockRemoteImages` regex helper)
- Modify: `src/html/render.ts:3` (import) and `src/html/render.ts:53-66` (`buildBody`)
- Test: `test/unit/render.test.ts` (new describe block)

**Interfaces:**
- Consumes: `makeSafeAttrValue`, `BASE`, `permissive`, `blocking` from Task 1.
- Produces: `sanitizeBody(html: string, opts: { blockRemoteImages: boolean }): string`, exported from `src/html/sanitize.ts` but **not** re-exported from `src/html/index.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/render.test.ts`:

```ts
describe('blockRemoteImages', () => {
  const remote = {
    'img src': '<img src="http://e.com/t.gif">',
    'protocol-relative src': '<img src="//e.com/t.gif">',
    srcset: '<img srcset="https://e.com/a.png 1x">',
    background: '<td background="https://e.com/b.png">x</td>',
    'css background-image': '<div style="background-image:url(https://e.com/x.png)">x</div>',
  };

  for (const [label, html] of Object.entries(remote)) {
    it(`neutralizes remote ${label}`, () => {
      const out = renderToHtml(msg({ bodyHtml: html }), { blockRemoteImages: true });
      expect(out).not.toContain('e.com/');
      expect(out).toContain('blocked:');
    });
  }

  it('leaves remote sources alone when the option is off', () => {
    const out = renderToHtml(msg({ bodyHtml: remote['img src'] }));
    expect(out).toContain('http://e.com/t.gif');
  });

  it('keeps data: and cid: URIs when blocking remote images', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const out = renderToHtml(
      msg({
        bodyHtml: '<img src="cid:img1">',
        attachments: [
          { name: 'i.png', mime: 'image/png', contentId: 'img1', hidden: true, data: png },
        ],
      }),
      { blockRemoteImages: true },
    );
    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toContain('blocked:');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/render.test.ts -t blockRemoteImages`
Expected: FAIL. The current regex only rewrites `<img src>` with an explicit `http(s)://`, so the protocol-relative, `srcset`, `background`, and CSS cases all still contain `e.com/`.

- [ ] **Step 3: Add `sanitizeBody` and delete the regex helper**

In `src/html/sanitize.ts`, append after `sanitizeHtml`:

```ts
/**
 * Sanitize a message body. With `blockRemoteImages`, http(s) and protocol-relative
 * URLs in `src`/`srcset`/`background`/`poster` and in CSS `url(...)` are neutralized.
 * Stylesheet contents inside `<style>` blocks are not reached — cssfilter only
 * processes inline declaration lists.
 */
export function sanitizeBody(html: string, opts: { blockRemoteImages: boolean }): string {
  return (opts.blockRemoteImages ? blocking : permissive).process(html);
}
```

Then delete the entire `blockRemoteImages` function (the old `export function blockRemoteImages(html: string): string { ... }` block) from the file.

- [ ] **Step 4: Wire `render.ts` to `sanitizeBody`**

Change the import at `src/html/render.ts:3` from:

```ts
import { blockRemoteImages as blockRemote, sanitizeHtml } from './sanitize.js';
```

to:

```ts
import { sanitizeBody } from './sanitize.js';
```

Then replace the body of `buildBody`'s `msg.bodyHtml` branch (`src/html/render.ts:54-66`) with:

```ts
  if (msg.bodyHtml) {
    let html = sanitizeBody(msg.bodyHtml, {
      blockRemoteImages: options.blockRemoteImages === true,
    });
    if (options.inlineImages !== false) {
      for (const a of msg.attachments) {
        if (a.contentId && a.data) {
          const cid = a.contentId.replace(/^</, '').replace(/>$/, '');
          html = html.split('cid:' + cid).join(dataUri(a));
        }
      }
    }
    return '<div class="msgp-body">' + html + '</div>';
  }
```

Note the `if (options.blockRemoteImages) html = blockRemote(html);` line is gone — blocking now happens inside the sanitizer, before `cid:` substitution.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit`
Expected: PASS, including the pre-existing `inlines cid: images as data: URIs` test.

- [ ] **Step 6: Verify typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean, with no unused-import warnings in `render.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/html/sanitize.ts src/html/render.ts test/unit/render.test.ts
git commit -m "feat: block remote resources inside the sanitizer, not a second pass"
```

---

## Task 3: Add the `RenderOptions.sanitize` override

**Files:**
- Modify: `src/types.ts:28-41` (`RenderOptions`)
- Modify: `src/html/render.ts` (`buildBody`)
- Test: `test/unit/render.test.ts` (new describe block)

**Interfaces:**
- Consumes: `sanitizeBody` from Task 2.
- Produces: `RenderOptions.sanitize?: (html: string) => string`.

- [ ] **Step 1: Write the failing tests**

Append to `test/unit/render.test.ts`:

```ts
describe('options.sanitize', () => {
  it('replaces the built-in sanitizer and uses its output verbatim', () => {
    const out = renderToHtml(msg({ bodyHtml: '<p>Body</p>' }), {
      sanitize: () => '<em>replaced</em>',
    });
    expect(out).toContain('<em>replaced</em>');
    expect(out).not.toContain('<p>Body</p>');
  });

  it('receives the raw body HTML before cid: substitution', () => {
    const seen: string[] = [];
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    renderToHtml(
      msg({
        bodyHtml: '<img src="cid:img1">',
        attachments: [
          { name: 'i.png', mime: 'image/png', contentId: 'img1', hidden: true, data: png },
        ],
      }),
      {
        sanitize: (html) => {
          seen.push(html);
          return html;
        },
      },
    );
    expect(seen).toEqual(['<img src="cid:img1">']);
  });

  it('takes over remote-image blocking too', () => {
    const out = renderToHtml(msg({ bodyHtml: '<img src="http://e.com/t.gif">' }), {
      blockRemoteImages: true,
      sanitize: (html) => html,
    });
    expect(out).toContain('http://e.com/t.gif');
    expect(out).not.toContain('blocked:');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/unit/render.test.ts -t "options.sanitize"`
Expected: FAIL with a TypeScript error that `sanitize` does not exist on `RenderOptions`.

- [ ] **Step 3: Add the option to `RenderOptions`**

In `src/types.ts`, add inside `RenderOptions` after the `blockRemoteImages` entry:

```ts
  /**
   * Replace the built-in sanitizer. Receives the raw body HTML before `cid:`
   * substitution. Fully overrides sanitization, `blockRemoteImages` included —
   * a custom sanitizer owns its own allowlist and remote-resource policy.
   */
  sanitize?: (html: string) => string;
```

- [ ] **Step 4: Use it in `buildBody`**

In `src/html/render.ts`, change the first statement of the `msg.bodyHtml` branch from:

```ts
    let html = sanitizeBody(msg.bodyHtml, {
      blockRemoteImages: options.blockRemoteImages === true,
    });
```

to:

```ts
    let html = options.sanitize
      ? options.sanitize(msg.bodyHtml)
      : sanitizeBody(msg.bodyHtml, { blockRemoteImages: options.blockRemoteImages === true });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/unit`
Expected: PASS.

- [ ] **Step 6: Verify typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/html/render.ts test/unit/render.test.ts
git commit -m "feat: add RenderOptions.sanitize to override the built-in sanitizer"
```

---

## Task 4: Update the README

**Files:**
- Modify: `README.md:3` (opening line), `README.md` `RenderOptions` list, `README.md` Security section

- [ ] **Step 1: Drop the dependency-free claim**

`README.md:3` currently reads:

> Dependency-free TypeScript library to parse Outlook `.msg` files to HTML string. Files are parsed locally — nothing is uploaded.

Replace with:

> TypeScript library to parse Outlook `.msg` files to HTML string. Files are parsed locally — nothing is uploaded. Runs in the browser, Node, and React Native — no DOM required.

- [ ] **Step 2: Update `package.json`'s description to match**

Change `"description"` in `package.json` from `"Dependency-free TypeScript library to parse and preview Outlook .msg files."` to:

```json
"description": "TypeScript library to parse and preview Outlook .msg files. No DOM required.",
```

- [ ] **Step 3: Add `sanitize` to the documented options**

The `RenderOptions` line in the API section currently reads:

> `RenderOptions`: `locale`, `formatDate`, `showHiddenAttachments`, `inlineImages`,
> `blockRemoteImages`, `fragment`.

Replace with:

> `RenderOptions`: `locale`, `formatDate`, `showHiddenAttachments`, `inlineImages`,
> `blockRemoteImages`, `fragment`, `sanitize`.
>
> `sanitize?: (html: string) => string` replaces the built-in sanitizer. It receives the raw body
> HTML before `cid:` substitution, and fully overrides sanitization — `blockRemoteImages` included.

- [ ] **Step 4: Rewrite the Security section**

Replace the whole Security section body with:

```markdown
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
```

- [ ] **Step 5: Verify the format check passes**

```bash
npm run format:check && npm run lint
```

Expected: both clean. If `format:check` fails, run `npm run format` and re-check.

- [ ] **Step 6: Commit**

```bash
git add README.md package.json
git commit -m "docs: document the xss sanitizer, sanitize option and RN boundary"
```

---

## Task 5: Rendering-fidelity sweep over the local fixture corpus

The 1016 samples in `test/fixtures/msg-samples/` are real mail — both the fixtures and
`test/snapshot/__snapshots__/message.test.ts.snap` are gitignored, and CI excludes the snapshot
suite. This task is a **local review gate that commits no test artifacts**; only allowlist fixes
get committed. Vitest's existing snapshots are the before/after diff.

**Files:**
- Possibly modify: `src/html/sanitize.ts` (allowlist tuning only)

- [ ] **Step 1: Confirm a usable baseline exists**

```bash
ls test/fixtures/msg-samples | wc -l && ls -la test/snapshot/__snapshots__/
```

Expected: a non-zero fixture count and an existing `message.test.ts.snap`. If the snapshot file is
missing, the baseline is gone — regenerate it from `main` before continuing:

```bash
git stash && npx vitest run test/snapshot -u && git stash pop
```

- [ ] **Step 2: Diff the new rendering against the baseline**

```bash
npx vitest run test/snapshot > /tmp/fidelity.txt 2>&1; tail -40 /tmp/fidelity.txt
```

Expected: FAIL with snapshot mismatches. The `parses <file>` tests must all still pass — parsing is
untouched, so any failure there is a real bug. Only `renders <file>` tests should differ.

- [ ] **Step 3: Review the diffs as fidelity regressions**

Read through `/tmp/fidelity.txt`. Classify every kind of change:

**Expected and acceptable** — non-allowlisted tags removed (`<iframe>`, `<form>`, `<o:p>`,
`<v:shape>`), comments and MSO conditional blocks gone, `<html>`/`<head>`/`<body>` wrappers
stripped, `<title>` text removed, inline `style` values normalized by cssfilter (trailing `;`,
whitespace), attribute quoting normalized.

**Regressions to fix** — visible text disappearing, tables collapsing, `class`/`bgcolor`/`width`
attributes dropped, `<style>` blocks vanishing, `cid:` references lost, CSS properties stripped
that email needs.

For each regression, add the missing tag or attribute to `GLOBAL_ATTRS`, `TABLE_ATTRS`, `IMG_ATTRS`,
or the allowlist in `buildWhiteList()` in `src/html/sanitize.ts`, then re-run Step 2. Repeat until
every remaining diff is in the acceptable list.

- [ ] **Step 4: Add a regression test for each allowlist fix**

For every attribute or tag added in Step 3, add an assertion to the
`preserves the table markup and inline styles real email depends on` test in
`test/unit/render.test.ts` so the corpus finding is locked in by a committed test. Example, if
`valign` on `<td>` turned out to be dropped:

```ts
    expect(out).toContain('valign="top"');
```

with the corresponding attribute added to the test's input HTML.

- [ ] **Step 5: Accept the reviewed snapshots**

```bash
npx vitest run test/snapshot -u
```

The regenerated `.snap` is gitignored — nothing to commit from this step.

- [ ] **Step 6: Run the full gate**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: all pass.

- [ ] **Step 7: Commit any allowlist fixes**

Only if Step 3 or Step 4 changed files:

```bash
git add src/html/sanitize.ts test/unit/render.test.ts
git commit -m "fix: widen sanitizer allowlist for real-world email markup"
```

If nothing changed, skip the commit and note that the corpus produced no fidelity regressions.

---

## Verification

Final state must satisfy:

- [ ] `npm run typecheck && npm run lint && npm run test` pass.
- [ ] `src/html/sanitize.ts` contains no HTML-matching regexes — only the `REMOTE_URL`,
      `REMOTE_CSS_URL`, and `CID_URI` URL-scheme patterns.
- [ ] `grep -rn "jsdom\|linkedom\|dompurify\|document\.\|window\." src/` returns nothing.
- [ ] `npm run build` succeeds and `xss` is external in `dist/` (a real dependency, not inlined).
- [ ] `sanitizeHtml` is still exported from `src/html/index.ts` with an unchanged signature.
