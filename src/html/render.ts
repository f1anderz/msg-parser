import { parseMsg } from '../message/index.js';
import type { MsgAttachment, MsgMessage, RenderOptions } from '../types.js';
import { blockRemoteImages as blockRemote, sanitizeHtml } from './sanitize.js';
import { PREVIEW_CSS } from './styles.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string;
  });
}

function fmtSize(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function fmtWho(name: string, email: string | null): string {
  let h = '';
  if (name) h += '<b>' + esc(name) + '</b>';
  if (email && email !== name) h += (h ? ' ' : '') + '<span>&lt;' + esc(email) + '&gt;</span>';
  return h || '<span>—</span>';
}

const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

function dataUri(att: MsgAttachment): string {
  const mime = att.mime && MIME_RE.test(att.mime) ? att.mime : 'application/octet-stream';
  return 'data:' + mime + ';base64,' + toBase64(att.data!);
}

function buildBody(msg: MsgMessage, options: RenderOptions): string {
  if (msg.bodyHtml) {
    let html = sanitizeHtml(msg.bodyHtml);
    if (options.inlineImages !== false) {
      for (const a of msg.attachments) {
        if (a.contentId && a.data) {
          const cid = a.contentId.replace(/^</, '').replace(/>$/, '');
          html = html.split('cid:' + cid).join(dataUri(a));
        }
      }
    }
    if (options.blockRemoteImages) html = blockRemote(html);
    return '<div class="msgp-body">' + html + '</div>';
  }
  if (msg.bodyText) {
    return '<div class="msgp-body"><pre>' + esc(msg.bodyText) + '</pre></div>';
  }
  return '<div class="msgp-body"><div class="msgp-empty">This message has no text.</div></div>';
}

function buildHead(msg: MsgMessage, options: RenderOptions): string {
  let rows = '<div class="msgp-subject">' + (esc(msg.subject) || '(no subject)') + '</div>';
  rows +=
    '<div class="msgp-row"><span class="msgp-label">From:</span><span class="msgp-who">' +
    fmtWho(msg.senderName, msg.senderEmail) +
    '</span></div>';
  const groups: Record<'to' | 'cc' | 'bcc', string[]> = { to: [], cc: [], bcc: [] };
  for (const r of msg.recipients) groups[r.type].push(fmtWho(r.name, r.email));
  const labels: Record<'to' | 'cc' | 'bcc', string> = { to: 'To:', cc: 'Cc:', bcc: 'Bcc:' };
  (['to', 'cc', 'bcc'] as const).forEach((k) => {
    if (groups[k].length)
      rows +=
        '<div class="msgp-row"><span class="msgp-label">' +
        labels[k] +
        '</span><span class="msgp-who">' +
        groups[k].join(', ') +
        '</span></div>';
  });
  if (msg.date) {
    const text = options.formatDate
      ? options.formatDate(msg.date)
      : msg.date.toLocaleString(options.locale || 'en-US');
    rows += '<div class="msgp-date">' + esc(text) + '</div>';
  }
  return '<div class="msgp-head">' + rows + '</div>';
}

function buildAttachments(msg: MsgMessage, options: RenderOptions): string {
  const visible = msg.attachments.filter((a) => !a.hidden || options.showHiddenAttachments);
  if (!visible.length) return '';
  const items = visible
    .map((a) => {
      const size = a.data ? ' <span class="msgp-size">' + fmtSize(a.data.length) + '</span>' : '';
      return '<span class="msgp-att">📎 ' + esc(a.name) + size + '</span>';
    })
    .join('');
  return '<div class="msgp-atts">' + items + '</div>';
}

/** Render a parsed message (or raw bytes) to a sanitized, self-contained HTML string. */
export function renderToHtml(
  input: MsgMessage | ArrayBuffer | Uint8Array,
  options: RenderOptions = {},
): string {
  const msg = input instanceof ArrayBuffer || input instanceof Uint8Array ? parseMsg(input) : input;
  const inner =
    '<div class="msgp">' +
    buildHead(msg, options) +
    buildBody(msg, options) +
    buildAttachments(msg, options) +
    '</div>';
  if (options.fragment) return inner;
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
    '<style>' +
    PREVIEW_CSS +
    '</style></head><body>' +
    inner +
    '</body></html>'
  );
}

/** Convenience: render straight from a File/Blob (reads the bytes for you). */
export async function renderMsgFile(
  input: File | Blob | ArrayBuffer | Uint8Array,
  options: RenderOptions = {},
): Promise<string> {
  if (input instanceof ArrayBuffer || input instanceof Uint8Array) {
    return renderToHtml(input, options);
  }
  const buf = await input.arrayBuffer();
  return renderToHtml(buf, options);
}
