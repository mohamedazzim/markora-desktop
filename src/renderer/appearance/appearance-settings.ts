export const APPEARANCE_SETTINGS_VERSION = 2 as const;

export type ColorMode = 'light' | 'dark' | 'system';
export type BuiltInThemeId = 'markora' | 'white' | 'paper' | 'forest' | 'midnight' | 'high-contrast' | 'academic' | 'sepia' | 'graphite';
export type ThemeSelectionId = BuiltInThemeId | 'adaptive' | `custom-${string}`;
export type SourceEditorTheme = 'adaptive' | 'github-light' | 'github-dark' | 'dracula';
export type CodeBlockTheme = 'adaptive' | 'github' | 'atom-one-dark' | 'monokai';
export type MermaidTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base';
export type LinkAppearance = 'underline' | 'subtle' | 'accent';
export type TableAppearance = 'grid' | 'minimal' | 'striped';
export type BlockquoteAppearance = 'bar' | 'boxed' | 'italic';
export type CodeAppearance = 'flat' | 'rounded' | 'elevated';

export interface ZenHiddenRegions {
  readonly workspaceSidebar: boolean;
  readonly outlineSidebar: boolean;
  readonly toolbar: boolean;
  readonly tabBar: boolean;
  readonly statusBar: boolean;
}

export interface WritingModeSettings {
  readonly focusMode: boolean;
  readonly typewriterMode: boolean;
  readonly zenMode: boolean;
  readonly zenHidden: ZenHiddenRegions;
  readonly fullscreen: boolean;
  readonly editorWidth: number;
  readonly contentWidth: number;
  readonly scrollPastEnd: boolean;
  readonly wordWrap: boolean;
}

export interface TypographySettings {
  readonly editorFont: string;
  readonly codeFont: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly paragraphSpacing: number;
  readonly headingSpacing: number;
  readonly editorPadding: number;
}

export interface ElementAppearanceSettings {
  readonly links: LinkAppearance;
  readonly tables: TableAppearance;
  readonly blockquotes: BlockquoteAppearance;
  readonly codeBlocks: CodeAppearance;
}

export interface ThemeSettings {
  readonly colorMode: ColorMode;
  /** Canonical interface selection. `builtInTheme` is retained for v2 exports. */
  readonly uiThemeId?: ThemeSelectionId;
  /** Canonical document selection. `documentTheme` is retained for v2 exports. */
  readonly documentThemeId?: ThemeSelectionId;
  readonly builtInTheme: BuiltInThemeId;
  /** Document surface theme. `adaptive` follows the UI theme. */
  readonly documentTheme: ThemeSelectionId;
  readonly sourceTheme: SourceEditorTheme;
  readonly codeTheme: CodeBlockTheme;
  readonly mermaidTheme: MermaidTheme;
  /** Already sanitized and scoped CSS only. */
  readonly customCss: string;
}

export interface AppearanceSettings {
  readonly version: typeof APPEARANCE_SETTINGS_VERSION;
  readonly writing: WritingModeSettings;
  readonly typography: TypographySettings;
  readonly elements: ElementAppearanceSettings;
  readonly theme: ThemeSettings;
}

export interface AppearanceImportResult {
  readonly settings: AppearanceSettings;
  readonly warnings: readonly string[];
  readonly migratedFrom?: number;
}

const DEFAULT_SETTINGS: AppearanceSettings = {
  version: APPEARANCE_SETTINGS_VERSION,
  writing: {
    focusMode: false,
    typewriterMode: false,
    zenMode: false,
    zenHidden: {
      workspaceSidebar: true,
      outlineSidebar: true,
      toolbar: true,
      tabBar: true,
      statusBar: true,
    },
    fullscreen: false,
    editorWidth: 1_200,
    contentWidth: 820,
    scrollPastEnd: false,
    wordWrap: true,
  },
  typography: {
    editorFont: 'Georgia, Cambria, serif',
    codeFont: "Consolas, 'Cascadia Code', monospace",
    fontSize: 16,
    lineHeight: 1.65,
    paragraphSpacing: 16,
    headingSpacing: 28,
    editorPadding: 48,
  },
  elements: {
    links: 'underline',
    tables: 'grid',
    blockquotes: 'bar',
    codeBlocks: 'rounded',
  },
  theme: {
    // A new installation opens into a calm, Typora-style paper surface. Users
    // can still opt into system/dark themes from Appearance at any time.
    colorMode: 'light',
    uiThemeId: 'white',
    documentThemeId: 'white',
    builtInTheme: 'white',
    documentTheme: 'white',
    sourceTheme: 'adaptive',
    codeTheme: 'adaptive',
    mermaidTheme: 'neutral',
    customCss: '',
  },
};

function cloneSettings(settings: AppearanceSettings): AppearanceSettings {
  return {
    version: APPEARANCE_SETTINGS_VERSION,
    writing: { ...settings.writing, zenHidden: { ...settings.writing.zenHidden } },
    typography: { ...settings.typography },
    elements: { ...settings.elements },
    theme: { ...settings.theme },
  };
}

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return cloneSettings(DEFAULT_SETTINGS);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;
}

function themeSelection(value: unknown, fallback: ThemeSelectionId): ThemeSelectionId {
  if (typeof value !== 'string') return fallback;
  if (value === 'adaptive' || BUILT_IN_THEME_IDS.has(value as BuiltInThemeId)) return value as ThemeSelectionId;
  return /^custom-[a-f0-9-]{36}$/iu.test(value) ? (value as ThemeSelectionId) : fallback;
}

const BUILT_IN_THEME_IDS = new Set<BuiltInThemeId>([
  'markora', 'white', 'paper', 'forest', 'midnight', 'high-contrast', 'academic', 'sepia', 'graphite',
]);

function fontFamily(value: unknown, fallback: string): string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32)
    ? value
    : fallback;
}

function safeCss(value: unknown): string {
  if (typeof value !== 'string' || value.length > 50_000) return '';
  const sanitized = sanitizeCustomCss(value);
  return sanitized.safe ? sanitized.css : '';
}

function normalizeVersionTwo(value: unknown): AppearanceSettings {
  const root = record(value);
  const writing = record(root.writing);
  const hidden = record(writing.zenHidden);
  const typography = record(root.typography);
  const elements = record(root.elements);
  const theme = record(root.theme);
  const defaults = DEFAULT_SETTINGS;

  return {
    version: APPEARANCE_SETTINGS_VERSION,
    writing: {
      focusMode: boolean(writing.focusMode, defaults.writing.focusMode),
      typewriterMode: boolean(writing.typewriterMode, defaults.writing.typewriterMode),
      zenMode: boolean(writing.zenMode, defaults.writing.zenMode),
      zenHidden: {
        workspaceSidebar: boolean(hidden.workspaceSidebar, defaults.writing.zenHidden.workspaceSidebar),
        outlineSidebar: boolean(hidden.outlineSidebar, defaults.writing.zenHidden.outlineSidebar),
        toolbar: boolean(hidden.toolbar, defaults.writing.zenHidden.toolbar),
        tabBar: boolean(hidden.tabBar, defaults.writing.zenHidden.tabBar),
        statusBar: boolean(hidden.statusBar, defaults.writing.zenHidden.statusBar),
      },
      fullscreen: boolean(writing.fullscreen, defaults.writing.fullscreen),
      editorWidth: boundedNumber(writing.editorWidth, defaults.writing.editorWidth, 480, 2_400),
      contentWidth: boundedNumber(writing.contentWidth, defaults.writing.contentWidth, 320, 1_600),
      scrollPastEnd: boolean(writing.scrollPastEnd, defaults.writing.scrollPastEnd),
      wordWrap: boolean(writing.wordWrap, defaults.writing.wordWrap),
    },
    typography: {
      editorFont: fontFamily(typography.editorFont, defaults.typography.editorFont),
      codeFont: fontFamily(typography.codeFont, defaults.typography.codeFont),
      fontSize: boundedNumber(typography.fontSize, defaults.typography.fontSize, 10, 48),
      lineHeight: boundedNumber(typography.lineHeight, defaults.typography.lineHeight, 1, 3),
      paragraphSpacing: boundedNumber(
        typography.paragraphSpacing,
        defaults.typography.paragraphSpacing,
        0,
        80,
      ),
      headingSpacing: boundedNumber(typography.headingSpacing, defaults.typography.headingSpacing, 0, 120),
      editorPadding: boundedNumber(typography.editorPadding, defaults.typography.editorPadding, 0, 160),
    },
    elements: {
      links: oneOf(elements.links, ['underline', 'subtle', 'accent'], defaults.elements.links),
      tables: oneOf(elements.tables, ['grid', 'minimal', 'striped'], defaults.elements.tables),
      blockquotes: oneOf(elements.blockquotes, ['bar', 'boxed', 'italic'], defaults.elements.blockquotes),
      codeBlocks: oneOf(elements.codeBlocks, ['flat', 'rounded', 'elevated'], defaults.elements.codeBlocks),
    },
    theme: {
      colorMode: oneOf(theme.colorMode, ['light', 'dark', 'system'], defaults.theme.colorMode),
      uiThemeId: themeSelection(theme.uiThemeId ?? theme.builtInTheme, defaults.theme.uiThemeId ?? defaults.theme.builtInTheme),
      builtInTheme: oneOf(
        theme.builtInTheme ?? theme.uiThemeId,
        ['markora', 'white', 'paper', 'forest', 'midnight', 'high-contrast', 'academic', 'sepia', 'graphite'],
        defaults.theme.builtInTheme,
      ),
      documentTheme: themeSelection(
        theme.documentTheme ?? theme.documentThemeId,
        defaults.theme.documentTheme,
      ),
      documentThemeId: themeSelection(theme.documentThemeId ?? theme.documentTheme, defaults.theme.documentThemeId ?? defaults.theme.documentTheme),
      sourceTheme: oneOf(
        theme.sourceTheme,
        ['adaptive', 'github-light', 'github-dark', 'dracula'],
        defaults.theme.sourceTheme,
      ),
      codeTheme: oneOf(
        theme.codeTheme,
        ['adaptive', 'github', 'atom-one-dark', 'monokai'],
        defaults.theme.codeTheme,
      ),
      mermaidTheme: oneOf(
        theme.mermaidTheme,
        ['default', 'neutral', 'dark', 'forest', 'base'],
        defaults.theme.mermaidTheme,
      ),
      customCss: safeCss(theme.customCss),
    },
  };
}

function migrateVersionOne(value: Record<string, unknown>): AppearanceSettings {
  const defaults = createDefaultAppearanceSettings();
  return normalizeVersionTwo({
    version: APPEARANCE_SETTINGS_VERSION,
    writing: {
      ...defaults.writing,
      focusMode: value.focusMode,
      typewriterMode: value.typewriterMode,
      zenMode: value.zenMode,
      fullscreen: value.fullscreen,
      contentWidth: value.contentWidth,
      editorWidth: value.editorWidth,
      scrollPastEnd: value.scrollPastEnd,
      wordWrap: value.wordWrap,
      zenHidden: record(value.zenHidden),
    },
    typography: {
      ...defaults.typography,
      editorFont: value.editorFont,
      codeFont: value.codeFont,
      fontSize: value.fontSize,
      lineHeight: value.lineHeight,
    },
    elements: defaults.elements,
    theme: {
      ...defaults.theme,
      colorMode: value.theme,
      builtInTheme: value.builtInTheme,
      customCss: value.customCss,
    },
  });
}

export function importAppearanceSettings(input: string | unknown): AppearanceImportResult {
  const warnings: string[] = [];
  let value: unknown = input;
  if (typeof input === 'string') {
    if (input.length > 1_000_000) {
      return {
        settings: createDefaultAppearanceSettings(),
        warnings: ['Appearance settings exceed the 1 MB import limit. Defaults were used.'],
      };
    }
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      return {
        settings: createDefaultAppearanceSettings(),
        warnings: ['Appearance settings are not valid JSON. Defaults were used.'],
      };
    }
  }

  const root = record(value);
  if (root.version === 1) {
    return {
      settings: migrateVersionOne(root),
      warnings: ['Appearance settings were migrated from version 1.'],
      migratedFrom: 1,
    };
  }
  if (root.version !== APPEARANCE_SETTINGS_VERSION) {
    return {
      settings: createDefaultAppearanceSettings(),
      warnings: ['Unsupported appearance settings version. Defaults were used.'],
    };
  }

  const settings = normalizeVersionTwo(root);
  if (JSON.stringify(settings) !== JSON.stringify(root)) {
    warnings.push('Invalid or out-of-range appearance values were normalized.');
  }
  return { settings, warnings };
}

export function exportAppearanceSettings(settings: AppearanceSettings): string {
  return `${JSON.stringify(normalizeVersionTwo(settings), null, 2)}\n`;
}

export function resetAppearanceSettings(): AppearanceSettings {
  return createDefaultAppearanceSettings();
}

/**
 * Migrate the pre-0.2 default (adaptive Markora/system colors) to the current
 * Classic White default. This is intentionally narrow: only the exact legacy
 * default combination is changed, so an existing user-selected theme is not
 * overwritten. The renderer persists the returned value once migration runs.
 */
export function migrateLegacyAdaptiveDefault(settings: AppearanceSettings): AppearanceSettings {
  const theme = settings.theme;
  const uiSelection = theme.uiThemeId ?? theme.builtInTheme;
  const documentSelection = theme.documentThemeId ?? theme.documentTheme;
  const usesLegacyDefault =
    theme.colorMode === 'system' &&
    theme.builtInTheme === 'markora' &&
    uiSelection === 'markora' &&
    documentSelection === 'adaptive';

  if (!usesLegacyDefault) return settings;

  return {
    ...settings,
    theme: {
      ...theme,
      colorMode: 'light',
      uiThemeId: 'white',
      documentThemeId: 'white',
      builtInTheme: 'white',
      documentTheme: 'white',
    },
  };
}
import { sanitizeCustomCss } from './custom-css';
