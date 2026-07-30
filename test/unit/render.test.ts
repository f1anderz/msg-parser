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

  it('drops tags outside the allowlist entirely', () => {
    expect(sanitizeHtml('<iframe src="http://e.com"></iframe>')).toBe('');
    expect(sanitizeHtml('<form action="http://e.com"><input name="p"></form>')).toBe('');
    expect(sanitizeHtml('<svg><animate onbegin="alert(1)" attributeName="x"></svg>')).toBe('');
  });

  it('removes script bodies rather than leaking them as text', () => {
    expect(sanitizeHtml('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('neutralizes dangerous CSS in inline style attributes', () => {
    const out1 = sanitizeHtml('<div style="background-image:url(javascript:evil())">x</div>');
    expect(out1).not.toContain('javascript:');
    expect(out1).toContain('>x<');

    const out2 = sanitizeHtml('<div style="width:expression(alert(1))">x</div>');
    expect(out2).not.toContain('expression');
    expect(out2).toContain('>x<');
  });

  it('escapes the noscript title mXSS payload instead of reviving it', () => {
    const out = sanitizeHtml('<noscript><p title="</noscript><img src=x onerror=alert(1)>">');
    // The payload survives as escaped *text* inside the title value — that is the
    // correct outcome. What matters is that it is never revived as markup, so assert
    // on the escaping rather than on the absence of the substring.
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
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

  // Found by the 1000-fixture corpus fidelity sweep (task 5): these attributes were
  // dropped from tags that otherwise survived sanitization, changing visible layout
  // (hr thickness/length, list numbering/bullet style, br line-wrap, body link color).
  it('preserves layout attributes the fidelity sweep found were dropped from surviving tags', () => {
    const html =
      '<body link="blue" vlink="purple">' +
      '<hr width="50%" size="3">' +
      '<ol start="5" type="a"><li>x</li></ol>' +
      '<ul type="square"><li>y</li></ul>' +
      '<br clear="all">' +
      '</body>';
    const out = sanitizeHtml(html);
    expect(out).toContain('link="blue"');
    expect(out).toContain('vlink="purple"');
    expect(out).toContain('width="50%"');
    expect(out).toContain('size="3"');
    expect(out).toContain('start="5"');
    expect(out).toContain('type="a"');
    expect(out).toContain('type="square"');
    expect(out).toContain('clear="all"');
  });

  it('keeps <style> blocks, which Outlook uses for message CSS', () => {
    expect(sanitizeHtml('<style>.b{font-weight:bold}</style><p class="b">x</p>')).toContain(
      '<style>.b{font-weight:bold}</style>',
    );
  });

  describe('<style> block handling', () => {
    it('preserves the contents of a comment-wrapped stylesheet (Outlook canonical export)', () => {
      const out = sanitizeHtml(
        '<style><!-- p.MsoNormal{margin:0in} --></style><p class="MsoNormal">x</p>',
      );
      expect(out).toContain('p.MsoNormal{margin:0in}');
      expect(out).toContain('class="MsoNormal"');
    });

    it('does not escape > in a child-combinator selector', () => {
      const out = sanitizeHtml('<style>td > p{color:red}</style>');
      expect(out).toContain('td > p');
      expect(out).not.toContain('td &gt; p');
    });

    it('emits balanced <style>/</style> even when the input tries to desync via a comment', () => {
      const out = sanitizeHtml('<style>a{}<!--</style>--><p>rest</p>');
      const opens = out.match(/<style/gi) ?? [];
      const closes = out.match(/<\/style/gi) ?? [];
      expect(opens.length).toBe(closes.length);
      expect(out).toContain('rest');
    });

    it('does not let a desynced <style> suppress the attachment list', () => {
      const out = renderToHtml(
        msg({
          bodyHtml: '<style>a{}<!--</style>--><p>rest</p>',
          attachments: [
            {
              name: 'important.pdf',
              mime: 'application/pdf',
              contentId: null,
              hidden: false,
              data: new Uint8Array(10),
            },
          ],
        }),
      );
      expect(out).toContain('important.pdf');
    });

    it('drops a <style> block whose captured contents contain a literal </style rather than reinserting it', () => {
      // The first `</style ... >` that is syntactically a real closing tag terminates the
      // capture; a fake one earlier (invalid tag name, so not matched as the closer)
      // leaves the literal "</style" substring inside the captured contents, which must
      // be dropped rather than spliced back in.
      const out = sanitizeHtml('<style>a{}</stylefoo>b{}</style><p>after</p>');
      expect(out).not.toContain('<style');
      expect(out).not.toContain('stylefoo');
      expect(out).toContain('<p>after</p>');
    });

    it('preserves a safe media attribute but never carries over other attributes', () => {
      const withMedia = sanitizeHtml('<style media="print">.a{color:red}</style>');
      expect(withMedia).toContain('<style media="print">');
      expect(withMedia).toContain('.a{color:red}');

      const withOnload = sanitizeHtml('<style onload="evil()">.a{color:red}</style>');
      expect(withOnload).not.toContain('onload');
      expect(withOnload).not.toContain('evil()');
      expect(withOnload).toContain('.a{color:red}');
    });
  });

  it('strips Outlook namespace tags and MSO conditional comments without leaking text', () => {
    expect(sanitizeHtml('<p>a<o:p></o:p>b</p>')).toBe('<p>ab</p>');
    expect(sanitizeHtml('<!--[if gte mso 9]><xml>junk</xml><![endif]--><p>hi</p>')).toBe(
      '<p>hi</p>',
    );
    expect(sanitizeHtml('<head><title>Msg</title></head><p>hi</p>')).not.toContain('Msg');
  });

  it('preserves cid: image references for later inlining', () => {
    expect(sanitizeHtml('<img src="cid:img1">')).toContain('cid:img1');
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

describe('blockRemoteImages', () => {
  const remote = {
    'img src': '<img src="http://e.com/t.gif">',
    'protocol-relative src': '<img src="//e.com/t.gif">',
    srcset: '<img srcset="https://e.com/a.png 1x">',
    'srcset with a later remote candidate': '<img srcset="./a.png 1x, https://e.com/b.png 2x">',
    background: '<td background="https://e.com/b.png">x</td>',
    'css background-image': '<div style="background-image:url(https://e.com/x.png)">x</div>',
    'css background-image, double-quoted url()':
      '<div style="background-image:url(&quot;//e.com/x.png&quot;)">x</div>',
  };

  for (const [label, html] of Object.entries(remote)) {
    it(`neutralizes remote ${label}`, () => {
      const out = renderToHtml(msg({ bodyHtml: html }), { blockRemoteImages: true });
      expect(out).not.toContain('e.com/');
      expect(out).toContain('blocked:');
    });
  }

  it('blocks a srcset whose first candidate is relative but a later one is remote', () => {
    const out = renderToHtml(msg({ bodyHtml: remote['srcset with a later remote candidate'] }), {
      blockRemoteImages: true,
    });
    expect(out).not.toContain('e.com/');
  });

  it('blocks every url() form (bare, single-quoted, double-quoted) in one declaration', () => {
    const html =
      '<div style="background:url(//e.com/a.png), url(\'//e.com/b.png\'), url(&quot;//e.com/c.png&quot;)">x</div>';
    const out = renderToHtml(msg({ bodyHtml: html }), { blockRemoteImages: true });
    expect(out).not.toContain('e.com/');
  });

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
