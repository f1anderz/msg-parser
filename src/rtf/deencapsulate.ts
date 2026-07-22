import { codepageToLabel, decodeBytes } from '../encoding/index.js';

const CHARSET_TO_CP: Record<number, number> = {
  0: 1252, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254,
  163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250,
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
    fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, generator: 1,
    pntext: 1, themedata: 1, colorschememapping: 1,
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
