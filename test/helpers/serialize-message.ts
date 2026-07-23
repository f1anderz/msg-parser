import type { MsgMessage } from '../../src/index.js';

export function serializeMessage(msg: MsgMessage): unknown {
  return {
    subject: msg.subject,
    senderName: msg.senderName,
    senderEmail: msg.senderEmail,
    date: msg.date ? msg.date.toISOString() : null,
    recipients: msg.recipients,
    hasHtml: msg.bodyHtml != null,
    bodyText: msg.bodyText,
    attachments: msg.attachments.map((a) => ({
      name: a.name,
      mime: a.mime,
      contentId: a.contentId,
      hidden: a.hidden,
      size: a.data ? a.data.length : null,
    })),
  };
}
