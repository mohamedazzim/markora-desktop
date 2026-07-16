import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/shared/contracts';
import { parseAppSettings } from '../../electron/main/app-settings-policy';

describe('main-process application settings policy', () => {
  it('migrates a valid partial legacy record onto current defaults', () => {
    expect(parseAppSettings({ theme: 'dark', fontSize: 18 })).toEqual({
      ...defaultSettings,
      theme: 'dark',
      fontSize: 18,
    });
  });

  it.each([
    { theme: 'remote' },
    { fontSize: 200 },
    { lineHeight: Number.POSITIVE_INFINITY },
    { contentWidth: 0 },
    { autosaveSeconds: 1 },
    { injected: true },
  ])('rejects malformed, unsafe, or unknown settings: %o', (candidate) => {
    expect(() => parseAppSettings(candidate)).toThrow();
  });

  it('does not allow prototype keys to become application settings', () => {
    const candidate = JSON.parse('{"theme":"light","__proto__":{"polluted":true}}');
    expect(() => parseAppSettings(candidate)).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
