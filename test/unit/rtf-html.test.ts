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
