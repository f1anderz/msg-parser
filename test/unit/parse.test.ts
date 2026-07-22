import { describe, expect, it } from 'vitest';
import { parseMsg } from '../../src/message/index.js';
import { InvalidMsgError } from '../../src/types.js';
import { buildCfb } from '../helpers/build-cfb.js';

const utf16 = (s: string): Uint8Array => {
  const b = new Uint8Array(s.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return b;
};
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

// A recipient type fixed prop (0C15 = recipient type, 0003 int). To=1.
function recipTypeStream(type: number): Uint8Array {
  const rec = new Uint8Array(8 + 16);
  const dv = new DataView(rec.buffer);
  dv.setUint16(8, 0x0003, true);
  dv.setUint16(10, 0x0c15, true);
  dv.setInt32(rec.length - 8, type, true);
  return rec;
}

describe('parseMsg', () => {
  it('throws InvalidMsgError on non-.msg input', () => {
    expect(() => parseMsg(new Uint8Array(600))).toThrow(InvalidMsgError);
  });

  it('parses subject, html body, recipient and attachment', () => {
    const buf = buildCfb({
      streams: [
        { name: '__substg1.0_0037001F', data: utf16('Test subject') },
        { name: '__substg1.0_5D02001F', data: utf16('Alice Sender') },
        { name: '__substg1.0_1013001F', data: utf16('<p>Hi there</p>') },
      ],
      storages: [
        {
          name: '__recip_version1.0_#00000000',
          streams: [
            { name: '__substg1.0_3001001F', data: utf16('Bob') },
            { name: '__substg1.0_39FE001F', data: utf16('bob@example.com') },
            { name: '__properties_version1.0', data: recipTypeStream(1) },
          ],
        },
        {
          name: '__attach_version1.0_#00000000',
          streams: [
            { name: '__substg1.0_3707001F', data: utf16('file.txt') },
            { name: '__substg1.0_37010102', data: ascii('file-bytes') },
          ],
        },
      ],
    });
    const msg = parseMsg(buf);
    expect(msg.subject).toBe('Test subject');
    expect(msg.senderName).toBe('Alice Sender');
    expect(msg.bodyHtml).toBe('<p>Hi there</p>');
    expect(msg.recipients).toEqual([{ name: 'Bob', email: 'bob@example.com', type: 'to' }]);
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]!.name).toBe('file.txt');
    expect(new TextDecoder().decode(msg.attachments[0]!.data!)).toBe('file-bytes');
  });

  it('accepts a Uint8Array input', () => {
    const buf = buildCfb({ streams: [{ name: '__substg1.0_0037001F', data: utf16('S') }] });
    expect(parseMsg(new Uint8Array(buf)).subject).toBe('S');
  });
});
