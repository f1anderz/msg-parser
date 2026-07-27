import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMsg, renderToHtml } from '../../src/index.js';
import { serializeMessage } from '../helpers/serialize-message.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures', 'msg-samples');

function listMsg(): string[] {
  try {
    return readdirSync(fixturesDir).filter((f) => f.toLowerCase().endsWith('.msg'));
  } catch {
    return [];
  }
}

const files = listMsg();

describe.skipIf(files.length === 0)('snapshot: real .msg samples', () => {
  for (const file of files) {
    it(`parses ${file}`, () => {
      const bytes = new Uint8Array(readFileSync(join(fixturesDir, file)));
      const msg = parseMsg(bytes);
      expect(serializeMessage(msg)).toMatchSnapshot();
    });

    it(`renders ${file}`, () => {
      const bytes = new Uint8Array(readFileSync(join(fixturesDir, file)));
      const html = renderToHtml(bytes);
      expect(html).toMatchSnapshot();
    });
  }
});
