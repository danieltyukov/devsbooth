import { describe, expect, it } from 'vitest';
import { safeNext } from './guards';

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/r/abcdefghij')).toBe('/r/abcdefghij');
    expect(safeNext('/u/ada?tab=1')).toBe('/u/ada?tab=1');
  });

  it('refuses anything that could leave the app', () => {
    for (const value of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'rooms']) {
      expect(safeNext(value)).toBe('/rooms');
    }
  });
});
