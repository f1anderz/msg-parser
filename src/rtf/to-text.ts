import { decodeBytes } from '../encoding/index.js';

/** Best-effort RTF → plain text fallback. */
export function rtfToText(rtfBytes: Uint8Array, cpLabel: string | null): string {
  const s = decodeBytes(rtfBytes, 'ascii');
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  const skipGroups: Record<string, number> = {
    fonttbl: 1, colortbl: 1, stylesheet: 1, info: 1, pict: 1,
    generator: 1, themedata: 1, colorschememapping: 1, datastore: 1,
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
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}
