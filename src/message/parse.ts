import { Cfb } from '../cfb/index.js';
import { codepageToLabel } from '../encoding/index.js';
import { detectCodepage, makeGetter, parseFixedProps, readSubStorageProps } from '../mapi/index.js';
import { decompressRtf, deencapsulateHtml, rtfToText } from '../rtf/index.js';
import type { MsgMessage } from '../types.js';

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function decodeHtmlBody(bytes: Uint8Array, htmlCpLabel: string | null): string {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, Math.min(bytes.length, 2048)));
  const m = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
  const label = (m && m[1]!.toLowerCase()) || htmlCpLabel || 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function parseStorageAsMessage(cfb: Cfb, entryIndex: number, isTopLevel: boolean): MsgMessage {
  const st = readSubStorageProps(cfb, entryIndex);
  const { props } = st;
  parseFixedProps(st.fixed, isTopLevel ? 32 : 24, props);
  const cpLabel = detectCodepage(props);
  const get = makeGetter(props, cpLabel);

  const msg: MsgMessage = {
    subject: asString(get('0037')) ?? asString(get('0E1D')) ?? '',
    senderName: asString(get('5D02')) ?? asString(get('0C1A')) ?? asString(get('0042')) ?? '',
    senderEmail: asString(get('5D01')) ?? asString(get('5D0A')) ?? null,
    date:
      get('0E06') instanceof Date
        ? (get('0E06') as Date)
        : get('0039') instanceof Date
          ? (get('0039') as Date)
          : null,
    headers: asString(get('007D')),
    recipients: [],
    attachments: [],
    bodyText: asString(get('1000')),
    bodyHtml: null,
    bodyRtf: null,
  };

  if (!msg.senderEmail) {
    const addr = asString(get('0C1F')) ?? asString(get('0065'));
    if (addr && addr.indexOf('@') > 0) msg.senderEmail = addr;
  }

  // HTML body
  const htmlProp = props['1013'];
  if (htmlProp && htmlProp.type === '001F') {
    msg.bodyHtml = asString(get('1013'));
  } else if (htmlProp && htmlProp.bytes) {
    const cp3fde =
      props['3FDE'] && 'value' in props['3FDE'] ? (props['3FDE'].value as number) : null;
    const htmlCp = codepageToLabel(cp3fde) || cpLabel;
    msg.bodyHtml = decodeHtmlBody(htmlProp.bytes, htmlCp);
  }

  // RTF body (compressed)
  const rtfProp = props['1009'];
  if (rtfProp && rtfProp.bytes) {
    const rtf = decompressRtf(rtfProp.bytes);
    if (rtf) {
      msg.bodyRtf = rtf;
      if (!msg.bodyHtml) {
        try {
          msg.bodyHtml = deencapsulateHtml(rtf);
        } catch {
          /* ignore */
        }
      }
      if (!msg.bodyText && !msg.bodyHtml) {
        try {
          msg.bodyText = rtfToText(rtf, cpLabel);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Recipients and attachments
  for (const sub of st.subStorages) {
    const name = sub.name;
    if (name.indexOf('__recip_version1.0_') === 0) {
      const r = readSubStorageProps(cfb, sub.index);
      parseFixedProps(r.fixed, 8, r.props);
      const rg = makeGetter(r.props, cpLabel);
      const rtype = rg('0C15');
      const smtp = asString(rg('39FE')) ?? asString(rg('3003'));
      msg.recipients.push({
        name: asString(rg('3001')) ?? '',
        email: smtp && smtp.indexOf('@') > 0 ? smtp : null,
        type: rtype === 2 ? 'cc' : rtype === 3 ? 'bcc' : 'to',
      });
    } else if (name.indexOf('__attach_version1.0_') === 0) {
      const a = readSubStorageProps(cfb, sub.index);
      parseFixedProps(a.fixed, 8, a.props);
      const ag = makeGetter(a.props, cpLabel);
      const dataProp = a.props['3701'];
      const att = {
        name: asString(ag('3707')) ?? asString(ag('3704')) ?? asString(ag('3001')) ?? 'attachment',
        mime: asString(ag('370E')),
        contentId: asString(ag('3712')),
        hidden: ag('7FFE') === true,
        data: null as Uint8Array | null,
      };
      if (dataProp) {
        if (dataProp.bytes) att.data = dataProp.bytes;
        // Embedded .msg (type 000D) is deferred: leave data null, keep display name.
        else if (dataProp.storageIndex !== undefined && dataProp.type === '000D') {
          att.name = asString(ag('3001')) ?? att.name;
        }
      }
      msg.attachments.push(att);
    }
  }

  const order: Record<string, number> = { to: 0, cc: 1, bcc: 2 };
  msg.recipients.sort((x, y) => order[x.type]! - order[y.type]!);
  return msg;
}

/** Parse a .msg byte buffer into a structured message object. */
export function parseMsg(input: ArrayBuffer | Uint8Array): MsgMessage {
  // Normalize to a standalone ArrayBuffer (copy, so we own a contiguous region).
  let buffer: ArrayBuffer;
  if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    buffer = copy.buffer;
  } else {
    buffer = input;
  }
  const cfb = new Cfb(buffer);
  return parseStorageAsMessage(cfb, 0, true);
}
