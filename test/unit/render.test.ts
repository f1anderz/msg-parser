import { describe, expect, it } from 'vitest';
import { sanitizeHtml, renderToHtml, renderMsgFile } from '../../src/html/index.js';
import type { MsgMessage } from '../../src/types.js';
import { buildCfb } from '../helpers/build-cfb.js';

const utf16 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
};

function msgBytes(): ArrayBuffer {
  return buildCfb({ streams: [{ name: '__substg1.0_0037001F', data: utf16('From file') }] });
}

function msg(overrides: Partial<MsgMessage> = {}): MsgMessage {
  return {
    subject: 'Subj',
    senderName: 'Alice',
    senderEmail: 'alice@example.com',
    date: new Date('2021-01-01T00:00:00Z'),
    headers: null,
    recipients: [{ name: 'Bob', email: 'bob@example.com', type: 'to' }],
    bodyHtml: '<p>Body</p>',
    bodyText: null,
    bodyRtf: null,
    attachments: [],
    ...overrides,
  };
}

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
});

describe('renderToHtml', () => {
  it('renders a full self-contained document with header and body', () => {
    const html = renderToHtml(msg());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Subj');
    expect(html).toContain('alice@example.com');
    expect(html).toContain('bob@example.com');
    expect(html).toContain('<p>Body</p>');
  });

  it('returns only a fragment when fragment:true', () => {
    const html = renderToHtml(msg(), { fragment: true });
    expect(html).not.toContain('<!doctype');
    expect(html).toContain('Subj');
  });

  it('inlines cid: images as data: URIs', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const html = renderToHtml(
      msg({
        bodyHtml: '<img src="cid:img1">',
        attachments: [
          { name: 'i.png', mime: 'image/png', contentId: 'img1', hidden: true, data: png },
        ],
      }),
    );
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('cid:img1');
  });

  it('neutralizes a malicious mime type instead of splicing it unescaped into the src attribute', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const html = renderToHtml(
      msg({
        bodyHtml: '<img src="cid:img1">',
        attachments: [
          {
            name: 'i.png',
            mime: 'x"><a href="https://evil/phish">x</a><img src="x',
            contentId: 'img1',
            hidden: true,
            data: png,
          },
        ],
      }),
    );
    expect(html).not.toContain('<a href="https://evil/phish"');
    expect(html).not.toContain('"><a');
    expect(html).toContain('data:application/octet-stream;base64,');
  });

  it('lists visible attachments with size', () => {
    const html = renderToHtml(
      msg({
        attachments: [
          {
            name: 'doc.pdf',
            mime: 'application/pdf',
            contentId: null,
            hidden: false,
            data: new Uint8Array(2048),
          },
        ],
      }),
    );
    expect(html).toContain('doc.pdf');
    expect(html).toContain('2.0');
  });

  it('falls back to plain text body', () => {
    const html = renderToHtml(msg({ bodyHtml: null, bodyText: 'just text' }));
    expect(html).toContain('just text');
  });
});

describe('renderMsgFile', () => {
  it('renders from an ArrayBuffer', async () => {
    const html = await renderMsgFile(msgBytes());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('From file');
  });

  it('renders from a Blob', async () => {
    const blob = new Blob([msgBytes()]);
    const html = await renderMsgFile(blob);
    expect(html).toContain('From file');
  });
});
