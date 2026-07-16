import { describe, expect, it } from 'vitest';
import { createDefaultAppearanceSettings } from '../../src/renderer/appearance/appearance-settings';
import {
  BUILT_IN_THEMES,
  appearanceClassNames,
  appearanceDocumentCssVariables,
  appearanceCustomThemeCss,
  appearanceApplicationCssVariables,
  appearanceCssVariables,
  hiddenZenRegions,
  resolveBuiltInTheme,
  resolveColorMode,
  themeDisplayName,
} from '../../src/renderer/appearance/themes';

describe('built-in themes and design tokens', () => {
  it('provides at least four complete, uniquely identified built-in themes', () => {
    expect(BUILT_IN_THEMES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(BUILT_IN_THEMES.map((theme) => theme.id)).size).toBe(BUILT_IN_THEMES.length);
    for (const theme of BUILT_IN_THEMES) {
      expect(Object.keys(theme.light)).toHaveLength(13);
      expect(Object.keys(theme.dark)).toHaveLength(13);
      expect(theme.description).not.toBe('');
    }
  });

  it('includes the Typora-inspired white writing theme with distinct document tokens', () => {
    const white = BUILT_IN_THEMES.find((theme) => theme.id === 'white');
    expect(white).toBeDefined();
    expect(white?.label).toBe('Markora White');
    expect(white?.description).toMatch(/paper-like/i);
    expect(white?.light.surface).toBe('#ffffff');
    expect(white?.light.background).toBe('#ffffff');
    expect(white?.light.text).toBe('#2b2b2b');
    expect(white?.light.link).toBe('#2f6f9f');
    expect(white?.light.codeBackground).toBe('#f6f8fa');
  });

  it('resolves light, dark, and system modes deterministically', () => {
    expect(resolveColorMode('light', true)).toBe('light');
    expect(resolveColorMode('dark', false)).toBe('dark');
    expect(resolveColorMode('system', true)).toBe('dark');
    expect(resolveBuiltInTheme('paper', 'system', false)).toMatchObject({
      mode: 'light',
      definition: { id: 'paper' },
    });
  });

  it('falls back to Markora if persisted theme identity is unavailable', () => {
    expect(resolveBuiltInTheme('missing' as never, 'light', false).definition.id).toBe('markora');
  });

  it('provides readable names for active built-in, adaptive, and custom themes', () => {
    expect(themeDisplayName('white')).toBe('Markora White');
    expect(themeDisplayName('adaptive')).toBe('Adaptive');
    expect(
      themeDisplayName('custom-11111111-1111-4111-8111-111111111111', [
        {
          id: 'custom-11111111-1111-4111-8111-111111111111',
          version: 1,
          name: 'My White',
          description: '',
          light: BUILT_IN_THEMES[0].light,
          dark: BUILT_IN_THEMES[0].dark,
          updatedAt: 1,
        },
      ]),
    ).toBe('My White');
  });

  it('exposes colors, typography, dimensions, spacing, and element tokens', () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = {
      ...defaults,
      typography: { ...defaults.typography, fontSize: 19, paragraphSpacing: 22 },
      writing: { ...defaults.writing, editorWidth: 1_400, contentWidth: 900 },
      elements: { ...defaults.elements, codeBlocks: 'elevated' as const },
    };
    const variables = appearanceCssVariables(settings, false);
    expect(variables).toMatchObject({
      '--markora-font-size': '19px',
      '--markora-paragraph-spacing': '22px',
      '--markora-editor-width': '1400px',
      '--markora-content-width': '900px',
      '--markora-code-shadow': '0 5px 18px rgb(0 0 0 / 16%)',
    });
    expect(variables['--markora-bg']).toMatch(/^#/);
    expect(variables['--accent']).toBe(variables['--markora-accent']);
  });

  it('keeps document theme tokens isolated from the interface theme', () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = {
      ...defaults,
      theme: { ...defaults.theme, uiThemeId: 'midnight' as const, documentThemeId: 'paper' as const },
    };
    const documentVariables = appearanceDocumentCssVariables(settings, false);
    const interfaceVariables = appearanceCssVariables(settings, false);
    expect(documentVariables['--doc-bg']).toBe('#fdfcf7');
    expect(documentVariables['--markora-bg']).toBe('#f6f4f0');
    expect(interfaceVariables['--ui-window-bg']).toBe('#edf1f7');
  });

  it('publishes opaque application-only dialog tokens for the body portal', () => {
    const defaults = createDefaultAppearanceSettings();
    const light = appearanceApplicationCssVariables(defaults, false);
    const dark = appearanceApplicationCssVariables(
      { ...defaults, theme: { ...defaults.theme, colorMode: 'dark' } },
      false,
    );
    expect(light['--dialog-bg']).toBeTruthy();
    expect(light['--dialog-text-primary']).toBeTruthy();
    expect(light['--dialog-input-bg']).toBeTruthy();
    expect(light['--dialog-overlay']).toBe('rgb(15 23 42 / 35%)');
    expect(dark['--dialog-overlay']).toBe('rgb(0 0 0 / 62%)');
    expect(Object.keys(light).some((name) => name.startsWith('--doc-'))).toBe(false);
    expect(Object.keys(light).some((name) => name.startsWith('--markora-'))).toBe(false);
  });

  it('sanitizes CSS from selected custom themes', () => {
    const defaults = createDefaultAppearanceSettings();
    const theme = {
      id: 'custom-11111111-1111-4111-8111-111111111111' as const,
      version: 1 as const,
      name: 'Safe',
      description: '',
      light: BUILT_IN_THEMES[0].light,
      dark: BUILT_IN_THEMES[0].dark,
      css: '.document-container { color: #123456; }',
      updatedAt: 1,
    };
    const css = appearanceCustomThemeCss(
      {
        ...defaults,
        theme: { ...defaults.theme, documentThemeId: theme.id },
      },
      [theme],
    );
    expect(css).toContain('.document-container');
  });
});

describe('writing-mode integration metadata', () => {
  it('returns no hidden regions outside Zen Mode', () => {
    expect(hiddenZenRegions(createDefaultAppearanceSettings())).toEqual([]);
  });

  it('maps every enabled mode and hidden region to stable classes', () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = {
      ...defaults,
      writing: {
        ...defaults.writing,
        focusMode: true,
        typewriterMode: true,
        zenMode: true,
        scrollPastEnd: true,
        wordWrap: false,
        zenHidden: {
          workspaceSidebar: true,
          outlineSidebar: false,
          toolbar: true,
          tabBar: false,
          statusBar: true,
        },
      },
    };
    expect(hiddenZenRegions(settings)).toEqual(['workspaceSidebar', 'toolbar', 'statusBar']);
    expect(appearanceClassNames(settings)).toEqual(
      expect.arrayContaining([
        'markora-focus-mode',
        'markora-typewriter-mode',
        'markora-zen-mode',
        'markora-scroll-past-end',
        'markora-no-wrap',
        'markora-hide-workspaceSidebar',
        'markora-hide-toolbar',
        'markora-hide-statusBar',
      ]),
    );
  });
});
