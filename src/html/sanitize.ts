/** Defense-in-depth HTML sanitization. The primary boundary is the consumer's sandboxed iframe. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*script\b[\s\S]*?<\/\s*script\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(<\w[^>]*\s(?:href|src)\s*=\s*["']?)\s*javascript:/gi, '$1blocked:');
}

/** Neutralize external http(s) image sources (used when blockRemoteImages is set). */
export function blockRemoteImages(html: string): string {
  return html.replace(/(<img\b[^>]*\ssrc\s*=\s*["']?)\s*https?:\/\/[^"'\s>]*/gi, '$1blocked:');
}
