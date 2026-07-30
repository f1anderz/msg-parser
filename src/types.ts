export interface MsgRecipient {
  name: string;
  email: string | null;
  type: 'to' | 'cc' | 'bcc';
}

export interface MsgAttachment {
  name: string;
  mime: string | null;
  contentId: string | null;
  hidden: boolean;
  data: Uint8Array | null;
}

export interface MsgMessage {
  subject: string;
  senderName: string;
  senderEmail: string | null;
  date: Date | null;
  headers: string | null;
  recipients: MsgRecipient[];
  bodyHtml: string | null;
  bodyText: string | null;
  bodyRtf: Uint8Array | null;
  attachments: MsgAttachment[];
}

export interface RenderOptions {
  /** BCP-47 locale for date formatting. Default 'en-US'. */
  locale?: string;
  /** Custom date formatter; overrides `locale`. */
  formatDate?: (d: Date) => string;
  /** Include hidden/inline attachments in the attachment list. Default false. */
  showHiddenAttachments?: boolean;
  /** Embed inline cid: images as data: URIs. Default true. */
  inlineImages?: boolean;
  /** Neutralize external http(s) image sources. Default false. */
  blockRemoteImages?: boolean;
  /**
   * Replace the built-in sanitizer. Receives the raw body HTML before `cid:`
   * substitution. Fully overrides sanitization, `blockRemoteImages` included —
   * a custom sanitizer owns its own allowlist and remote-resource policy.
   */
  sanitize?: (html: string) => string;
  /** Return only the inner HTML fragment, not a full document. Default false. */
  fragment?: boolean;
}

export class InvalidMsgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMsgError';
  }
}
