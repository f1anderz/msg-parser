/**
 * Generates a fully synthetic, PII-free sample `.msg` fixture for snapshot tests
 * and the demo. Uses the project's own `buildCfb` test helper (single source of
 * truth for the compound-file layout) so there is no duplicated format logic.
 *
 * Run:  node scripts/generate-sample-msg.ts   (Node >= 22 strips the TS types)
 * Output: test/fixtures/sample-invoice.msg
 *
 * All names, addresses, and content below are invented. Do not put real data here.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCfb, type BuildStorage } from '../test/helpers/build-cfb.ts';

const utf16 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
};
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Top-level fixed props (header 32) carrying a delivery date (0E06, type 0040 FILETIME). */
function topFixedWithDate(iso: string): Uint8Array {
  const rec = new Uint8Array(32 + 16);
  const dv = new DataView(rec.buffer);
  dv.setUint16(32, 0x0040, true); // type PtypTime
  dv.setUint16(34, 0x0e06, true); // PidTagMessageDeliveryTime
  const ms = Date.parse(iso);
  const ticks = (BigInt(ms) + 11644473600000n) * 10000n; // 100ns since 1601
  dv.setUint32(40, Number(ticks & 0xffffffffn), true);
  dv.setUint32(44, Number(ticks >> 32n), true);
  return rec;
}

/** Recipient fixed props (header 8) carrying recipient type 0C15 (1=To, 2=Cc, 3=Bcc). */
function recipType(type: number): Uint8Array {
  const rec = new Uint8Array(8 + 16);
  const dv = new DataView(rec.buffer);
  dv.setUint16(8, 0x0003, true); // PtypInteger32
  dv.setUint16(10, 0x0c15, true); // PidTagRecipientType
  dv.setInt32(16, type, true);
  return rec;
}

/** Attachment fixed props (header 8) marking it hidden/inline (7FFE, type 000B bool). */
function attachHidden(): Uint8Array {
  const rec = new Uint8Array(8 + 16);
  const dv = new DataView(rec.buffer);
  dv.setUint16(8, 0x000b, true); // PtypBoolean
  dv.setUint16(10, 0x7ffe, true); // PidTagAttachmentHidden
  dv.setUint8(16, 1);
  return rec;
}

/**
 * Wrap RTF text in an uncompressed "MELA" compressed-RTF container (the format
 * decompressRtf recognizes alongside LZFu). Exercises the decompress + \fromhtml
 * de-encapsulation path without needing an LZFu compressor.
 */
function melaRtf(rtf: string): Uint8Array {
  const raw = utf8(rtf);
  const out = new Uint8Array(16 + raw.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, raw.length + 12, true); // compSize (unused by the MELA path)
  dv.setUint32(4, raw.length, true); // rawSize
  dv.setUint32(8, 0x414c454d, true); // magic "MELA"
  dv.setUint32(12, 0, true); // reserved
  out.set(raw, 16);
  return out;
}

// A minimal 1x1 transparent PNG (real bytes, tiny) for the inline cid image.
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const BODY_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body' +
  ' style="font-family:Arial,sans-serif;color:#1f2733">' +
  '<div style="max-width:520px;margin:0 auto;border:1px solid #e6ebf2;border-radius:10px;overflow:hidden">' +
  '<div style="background:#476cff;color:#fff;padding:20px 24px;text-align:center">' +
  '<img src="cid:logo@sample" alt="Logo" width="24" height="24" style="vertical-align:middle">' +
  '<span style="font-size:18px;font-weight:700;margin-left:8px;vertical-align:middle">SAMPLE&nbsp;CO</span></div>' +
  '<div style="padding:24px">' +
  '<h2 style="margin:0 0 8px">Invoice #42 is ready for approval</h2>' +
  '<p style="margin:0 0 16px;color:#69758a">A synthetic sample email used for msg-previewer snapshot tests.</p>' +
  '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
  '<tr><td style="padding:8px 0;color:#69758a">Issuer</td><td style="padding:8px 0;text-align:right">Dana Reviewer</td></tr>' +
  '<tr><td style="padding:8px 0;color:#69758a">Due date</td><td style="padding:8px 0;text-align:right">2026-03-01</td></tr>' +
  '<tr><td style="padding:8px 0;color:#69758a">Total</td><td style="padding:8px 0;text-align:right"><b>44.00 EUR</b></td></tr>' +
  '</table>' +
  '<p style="margin:20px 0 0"><a href="https://example.com/invoices/42"' +
  ' style="background:#4caf50;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Approve invoice</a></p>' +
  '</div></div></body></html>';

const FAKE_PDF = utf8('%PDF-1.4\n% synthetic sample attachment — not a real document\n%%EOF\n');

const message: BuildStorage = {
  streams: [
    { name: '__substg1.0_0037001F', data: utf16('Invoice #42 is ready for approval') }, // subject
    { name: '__substg1.0_5D02001F', data: utf16('Sample Co Billing') }, // sender name
    { name: '__substg1.0_5D01001F', data: utf16('billing@sample.example') }, // sender SMTP
    {
      name: '__substg1.0_007D001F',
      data: utf16('Received: from sample.example\r\nSubject: Invoice #42 is ready for approval'),
    }, // transport headers
    { name: '__substg1.0_10130102', data: utf8(BODY_HTML) }, // HTML body as BINARY (0102) — exercises decodeHtmlBody
    { name: '__properties_version1.0', data: topFixedWithDate('2026-02-10T09:30:00Z') },
  ],
  storages: [
    {
      name: '__recip_version1.0_#00000000',
      streams: [
        { name: '__substg1.0_3001001F', data: utf16('Dana Reviewer') },
        { name: '__substg1.0_39FE001F', data: utf16('dana.reviewer@example.com') },
        { name: '__properties_version1.0', data: recipType(1) }, // To
      ],
    },
    {
      name: '__recip_version1.0_#00000001',
      streams: [
        { name: '__substg1.0_3001001F', data: utf16('Sam Approver') },
        { name: '__substg1.0_39FE001F', data: utf16('sam.approver@example.com') },
        { name: '__properties_version1.0', data: recipType(2) }, // Cc
      ],
    },
    {
      name: '__attach_version1.0_#00000000',
      streams: [
        { name: '__substg1.0_3707001F', data: utf16('invoice-42.pdf') }, // long filename
        { name: '__substg1.0_370E001F', data: utf16('application/pdf') }, // mime
        { name: '__substg1.0_37010102', data: FAKE_PDF }, // data
      ],
    },
    {
      name: '__attach_version1.0_#00000001',
      streams: [
        { name: '__substg1.0_3707001F', data: utf16('logo.png') },
        { name: '__substg1.0_370E001F', data: utf16('image/png') },
        { name: '__substg1.0_3712001F', data: utf16('logo@sample') }, // content-id (matches cid:logo@sample)
        { name: '__substg1.0_37010102', data: PNG_1x1 },
        { name: '__properties_version1.0', data: attachHidden() }, // hidden/inline
      ],
    },
  ],
};

// Encapsulated HTML stored ONLY in compressed RTF (\fromhtml), the case where
// Outlook keeps the HTML body solely inside RTF. No 1013 prop, so the parser must
// decompress the RTF and de-encapsulate the HTML.
const RTF_FROMHTML =
  '{\\rtf1\\ansi\\fromhtml1 \\htmlrtf0 ' +
  '{\\*\\htmltag84 <html>}{\\*\\htmltag <head><meta charset="utf-8"></head>}' +
  '{\\*\\htmltag <body style="font-family:Arial,sans-serif">}' +
  '{\\*\\htmltag <h2>}Meeting notes{\\*\\htmltag </h2>}' +
  '{\\*\\htmltag <p>}This HTML body was recovered from compressed RTF ' +
  '(fromhtml de-encapsulation) - a synthetic sample.{\\*\\htmltag </p>}' +
  '{\\*\\htmltag </body>}{\\*\\htmltag </html>}}';

const rtfMessage: BuildStorage = {
  streams: [
    { name: '__substg1.0_0037001F', data: utf16('Meeting notes (HTML-in-RTF sample)') },
    { name: '__substg1.0_5D02001F', data: utf16('Sample Co Notes') },
    { name: '__substg1.0_5D01001F', data: utf16('notes@sample.example') },
    { name: '__substg1.0_10090102', data: melaRtf(RTF_FROMHTML) }, // compressed RTF, no direct HTML
    { name: '__properties_version1.0', data: topFixedWithDate('2026-02-11T14:05:00Z') },
  ],
  storages: [
    {
      name: '__recip_version1.0_#00000000',
      streams: [
        { name: '__substg1.0_3001001F', data: utf16('Dana Reviewer') },
        { name: '__substg1.0_39FE001F', data: utf16('dana.reviewer@example.com') },
        { name: '__properties_version1.0', data: recipType(1) },
      ],
    },
  ],
};

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'test', 'fixtures');
mkdirSync(outDir, { recursive: true });

for (const [name, storage] of [
  ['sample-invoice.msg', message],
  ['sample-html-in-rtf.msg', rtfMessage],
] as const) {
  const buf = buildCfb(storage);
  const outPath = join(outDir, name);
  writeFileSync(outPath, Buffer.from(buf));
  console.log(`wrote ${outPath} (${buf.byteLength} bytes)`);
}
