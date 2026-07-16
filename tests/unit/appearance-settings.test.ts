import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_SETTINGS_VERSION,
  createDefaultAppearanceSettings,
  exportAppearanceSettings,
  importAppearanceSettings,
  migrateLegacyAdaptiveDefault,
  resetAppearanceSettings,
} from '../../src/renderer/appearance/appearance-settings';

describe('versioned appearance settings', () => {
  it('creates independent defaults covering every writing and theme setting', () => {
    const first = createDefaultAppearanceSettings();
    const second = createDefaultAppearanceSettings();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.writing.zenHidden).not.toBe(second.writing.zenHidden);
    expect(first).toMatchObject({
      version: APPEARANCE_SETTINGS_VERSION,
      writing: {
        focusMode: false,
        typewriterMode: false,
        zenMode: false,
        fullscreen: false,
        scrollPastEnd: false,
        wordWrap: true,
      },
      theme: { colorMode: 'light', builtInTheme: 'white' },
    });
  });

  it('round-trips current settings through stable, versioned JSON', () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = {
      ...defaults,
      writing: { ...defaults.writing, focusMode: true, contentWidth: 940 },
      theme: { ...defaults.theme, builtInTheme: 'forest' as const },
    };
    const serialized = exportAppearanceSettings(settings);
    const imported = importAppearanceSettings(serialized);
    expect(serialized).toContain('"version": 2');
    expect(imported.settings).toEqual(settings);
    expect(imported.warnings).toEqual([]);
  });

  it('migrates legacy version-one flat settings', () => {
    const imported = importAppearanceSettings({
      version: 1,
      focusMode: true,
      typewriterMode: true,
      zenMode: true,
      fullscreen: true,
      contentWidth: 700,
      editorWidth: 1_000,
      scrollPastEnd: true,
      wordWrap: false,
      editorFont: 'Aptos',
      codeFont: 'Consolas',
      fontSize: 18,
      lineHeight: 1.8,
      theme: 'dark',
      builtInTheme: 'midnight',
    });
    expect(imported.migratedFrom).toBe(1);
    expect(imported.settings).toMatchObject({
      version: 2,
      writing: {
        focusMode: true,
        typewriterMode: true,
        zenMode: true,
        fullscreen: true,
        contentWidth: 700,
        wordWrap: false,
      },
      typography: { editorFont: 'Aptos', fontSize: 18, lineHeight: 1.8 },
      theme: { colorMode: 'dark', builtInTheme: 'midnight' },
    });
  });

  it('bounds numeric input and normalizes invalid enum values', () => {
    const defaults = createDefaultAppearanceSettings();
    const imported = importAppearanceSettings({
      ...defaults,
      writing: { ...defaults.writing, editorWidth: 99_999, contentWidth: -20 },
      typography: { ...defaults.typography, fontSize: 2, lineHeight: 99 },
      theme: { ...defaults.theme, colorMode: 'neon', builtInTheme: 'unknown' },
    });
    expect(imported.settings.writing.editorWidth).toBe(2_400);
    expect(imported.settings.writing.contentWidth).toBe(320);
    expect(imported.settings.typography.fontSize).toBe(10);
    expect(imported.settings.typography.lineHeight).toBe(3);
    expect(imported.settings.theme).toMatchObject({ colorMode: 'light', builtInTheme: 'white' });
    expect(imported.warnings).not.toHaveLength(0);
  });

  it('normalizes independent interface and document theme selections', () => {
    const defaults = createDefaultAppearanceSettings();
    const imported = importAppearanceSettings({
      ...defaults,
      theme: {
        ...defaults.theme,
        uiThemeId: 'paper',
        documentThemeId: 'custom-11111111-1111-4111-8111-111111111111',
      },
    });
    expect(imported.settings.theme).toMatchObject({
      uiThemeId: 'paper',
      builtInTheme: 'white',
      documentThemeId: 'custom-11111111-1111-4111-8111-111111111111',
      documentTheme: 'white',
    });
  });

  it('rejects malicious custom CSS during theme import', () => {
    const defaults = createDefaultAppearanceSettings();
    const imported = importAppearanceSettings({
      ...defaults,
      theme: { ...defaults.theme, customCss: '@import url(https://example.com/spy.css);' },
    });
    expect(imported.settings.theme.customCss).toBe('');
    expect(imported.warnings).not.toHaveLength(0);
  });

  it('fails safely for malformed, oversized, and unsupported imports', () => {
    expect(importAppearanceSettings('{bad').warnings[0]).toMatch(/valid JSON/);
    expect(importAppearanceSettings('x'.repeat(1_000_001)).warnings[0]).toMatch(/1 MB/);
    expect(importAppearanceSettings({ version: 99 }).warnings[0]).toMatch(/Unsupported/);
    expect(importAppearanceSettings({ version: 99 }).settings).toEqual(createDefaultAppearanceSettings());
  });

  it('resets to a fresh default object', () => {
    expect(resetAppearanceSettings()).toEqual(createDefaultAppearanceSettings());
    expect(resetAppearanceSettings()).not.toBe(resetAppearanceSettings());
  });

  it('migrates only the legacy adaptive default to Classic White', () => {
    const defaults = createDefaultAppearanceSettings();
    const legacy = {
      ...defaults,
      theme: {
        ...defaults.theme,
        colorMode: 'system' as const,
        uiThemeId: 'markora' as const,
        builtInTheme: 'markora' as const,
        documentThemeId: 'adaptive' as const,
        documentTheme: 'adaptive' as const,
      },
    };
    const migrated = migrateLegacyAdaptiveDefault(legacy);
    expect(migrated.theme).toMatchObject({
      colorMode: 'light',
      uiThemeId: 'white',
      builtInTheme: 'white',
      documentThemeId: 'white',
      documentTheme: 'white',
    });
    const explicit = migrateLegacyAdaptiveDefault({
      ...legacy,
      theme: { ...legacy.theme, builtInTheme: 'paper' as const, uiThemeId: 'paper' as const },
    });
    expect(explicit.theme.colorMode).toBe('system');
    expect(explicit.theme.builtInTheme).toBe('paper');
  });
});
