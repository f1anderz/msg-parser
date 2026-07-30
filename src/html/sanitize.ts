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
// `<hr>`'s legacy `width`/`size` change its rendered thickness/length; `<ol>`'s
// `start`/`type` and `<ul>`'s `type` change visible numbering/bullet style; `<br clear>`
// affects text-wrap around floated layout elements. All four are common in real-world
// email HTML and were confirmed dropped from surviving (not merely comment-wrapped)
// elements by the corpus fidelity sweep.
//
// Caveat for anyone re-running that sweep: "surviving (not merely comment-wrapped)" is
// the right lens for ordinary markup, where a comment wrapper is just noise xss strips.
// It is the WRONG lens for `<style>` — Outlook wraps entire stylesheets in `<style><!--
// ... --></style>`, so for that tag comment-wrapped content is the load-bearing case,
// not noise. Treat `<style>` contents as their own category rather than folding them
// into this drop-detection pass.
const HR_ATTRS = ['width', 'size'];
const OL_ATTRS = ['start', 'type'];
const UL_ATTRS = ['type'];
const BR_ATTRS = ['clear'];
const REMOTE_ATTRS = new Set(['src', 'background', 'poster']);
const REMOTE_URL = /^\s*(?:https?:)?\/\//i;
// Matches the quote xss's attribute-value escaping may have already turned a literal
// `"` into (`&quot;`/numeric character references), plus the two unescaped forms.
const CSS_URL_QUOTE = `(?:['"]|&quot;|&#0*34;|&#x0*22;)`;
const REMOTE_CSS_URL = new RegExp(
  `url\\(\\s*${CSS_URL_QUOTE}?\\s*(?:https?:)?\\/\\/[^'")\\s]*${CSS_URL_QUOTE}?`,
  'gi',
);
const CID_URI = /^cid:/i;

/**
 * `<style>` contents are raw CSS text in HTML parsing, but xss routes allowlisted tags
 * through its ordinary element-content path: it strips HTML comments (destroying
 * Outlook's canonical `<style><!-- ... --></style>` export, which is how most
 * Word/Outlook-composed messages ship their CSS) and escapes `>` to `&gt;` (breaking
 * child-combinator selectors, and never getting decoded back by a browser because
 * `<style>` contents are never HTML-parsed). A malformed comment wrapper can also make
 * xss drop the real closing `</style>`, leaving an unbalanced tag that swallows the rest
 * of the document as CSS text.
 *
 * Fix: extract every `<style>...</style>` block before `process()` runs, replace it with
 * an opaque placeholder token that passes through as plain text, then splice the raw,
 * unmodified contents back in afterwards. `<style>` contents remain unfiltered (a
 * disclosed, deliberate limitation — see README) but are no longer corrupted or capable
 * of desynchronizing the parser.
 */
const STYLE_BLOCK_RE = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;
const MEDIA_ATTR_RE = /\bmedia\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const SAFE_MEDIA_VALUE = /^[a-zA-Z0-9 ,()\-:]+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Picks a placeholder token that cannot collide with attacker-controlled input: start
 * from a fixed, unlikely-to-appear prefix and, if the input already contains it,
 * deterministically extend it (never `Math.random()`) until it provably does not.
 */
function pickStylePlaceholderPrefix(html: string): string {
  let prefix = 'XSSSTYLEPLACEHOLDER';
  let salt = 0;
  while (html.includes(prefix)) {
    salt += 1;
    prefix = `XSSSTYLEPLACEHOLDER${salt}`;
  }
  return prefix;
}

interface StashedStyle {
  media: string | null;
  contents: string;
}

function stashStyleBlocks(html: string): { html: string; restore: (out: string) => string } {
  if (!/<style\b/i.test(html)) return { html, restore: (out) => out };

  const prefix = pickStylePlaceholderPrefix(html);
  const blocks: (StashedStyle | null)[] = [];

  const replaced = html.replace(STYLE_BLOCK_RE, (_match, attrs: string, contents: string) => {
    const mediaMatch = MEDIA_ATTR_RE.exec(attrs);
    let media: string | null = null;
    if (mediaMatch) {
      const raw = mediaMatch[2] ?? mediaMatch[3] ?? mediaMatch[4] ?? '';
      if (SAFE_MEDIA_VALUE.test(raw)) media = raw;
    }
    const idx = blocks.length;
    // Reinserted content must never be able to close its own element or open a new
    // one: if it contains a literal `</style` or `<script`, drop the whole block
    // rather than splicing it back in.
    const unsafe = /<\/style/i.test(contents) || /<script/i.test(contents);
    blocks.push(unsafe ? null : { media, contents });
    return `${prefix}${idx}${prefix}`;
  });

  const placeholderRe = new RegExp(`${escapeRegExp(prefix)}(\\d+)${escapeRegExp(prefix)}`, 'g');
  const restore = (out: string): string =>
    out.replace(placeholderRe, (_match, idxStr: string) => {
      const block = blocks[Number(idxStr)];
      if (!block) return '';
      const mediaAttr = block.media ? ` media="${block.media}"` : '';
      return `<style${mediaAttr}>${block.contents}</style>`;
    });

  return { html: replaced, restore };
}

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
  wl.hr = uniq([...(wl.hr ?? []), ...HR_ATTRS]);
  wl.ol = uniq([...(wl.ol ?? []), ...OL_ATTRS]);
  wl.ul = uniq([...(wl.ul ?? []), ...UL_ATTRS]);
  wl.br = uniq([...(wl.br ?? []), ...BR_ATTRS]);
  // `<style>` is deliberately NOT allowlisted here: xss would route its contents through
  // the ordinary element-content path (stripping comments, escaping `>`), corrupting real
  // stylesheets. Its contents are stashed out-of-band by `stashStyleBlocks` and spliced
  // back in verbatim after `process()` runs; see `stripIgnoreTagBody` below for the
  // fallback if a `<style>` somehow still reaches xss unstashed.
  // `link`/`vlink` set the default and visited-link colors for the whole message;
  // confirmed dropped from a surviving `<body>` by the corpus fidelity sweep.
  wl.body = uniq([...GLOBAL_ATTRS, 'bgcolor', 'link', 'vlink']);
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
    if (attr === 'srcset') {
      // `srcset` is a comma-separated candidate list (`url descriptor, url descriptor,
      // ...`); REMOTE_URL is `^`-anchored, so it only ever saw the first candidate.
      // Blank the whole attribute if ANY candidate resolves to a remote origin.
      const isRemote = clean
        .split(',')
        .some((candidate) => REMOTE_URL.test(candidate.trim().split(/\s+/)[0] ?? ''));
      return isRemote ? 'blocked:' : clean;
    }
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
  // These tags take their contents with them. `style` contents are normally stashed out
  // of band before `process()` runs (see `stashStyleBlocks`) and never reach xss at all;
  // this entry is the fallback for a `<style>` that somehow survives unstashed (e.g. no
  // closing tag), so its contents are dropped rather than leaked as visible text.
  stripIgnoreTagBody: ['script', 'title', 'xml', 'style'],
};

const permissive = new Filter({ ...BASE, safeAttrValue: makeSafeAttrValue(false) });
const blocking = new Filter({ ...BASE, safeAttrValue: makeSafeAttrValue(true) });

/** Defense-in-depth HTML sanitization. The primary boundary is the consumer's sandboxed iframe. */
export function sanitizeHtml(html: string): string {
  const { html: stashed, restore } = stashStyleBlocks(html);
  return restore(permissive.process(stashed));
}

/**
 * Sanitize a message body. With `blockRemoteImages`, http(s) and protocol-relative
 * URLs in `src`/`srcset`/`background`/`poster` and in CSS `url(...)` are neutralized.
 * `<style>` block contents are stashed verbatim (see `stashStyleBlocks`) and are not
 * filtered — `blockRemoteImages` does not reach `url()` inside them, nor inside
 * `<link>`/`@import`, which are not allowlisted at all.
 */
export function sanitizeBody(html: string, opts: { blockRemoteImages: boolean }): string {
  const { html: stashed, restore } = stashStyleBlocks(html);
  return restore((opts.blockRemoteImages ? blocking : permissive).process(stashed));
}
