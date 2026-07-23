import { describe, expect, it } from 'vitest';
import { version, InvalidMsgError } from '../../src/index.js';

describe('package smoke', () => {
  it('exposes a version string', () => {
    expect(version).toBe('0.1.0');
  });

  it('exposes InvalidMsgError', () => {
    const err = new InvalidMsgError('bad');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidMsgError');
  });
});
