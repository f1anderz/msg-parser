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

/** Defense-in-depth HTML sanitization. The primary boundary is the consumer's sandboxed iframe. */
export function sanitizeHtml(html: string): string {
  return permissive.process(html);
}

/** Neutralize external http(s) image sources (used when blockRemoteImages is set). */
export function blockRemoteImages(html: string): string {
  return html.replace(/(<img\b[^>]*\ssrc\s*=\s*["']?)\s*https?:\/\/[^"'\s>]*/gi, '$1blocked:');
}
