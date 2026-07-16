import type {
  AppearanceSettings,
  BuiltInThemeId,
  ColorMode,
  ThemeSelectionId,
  ZenHiddenRegions,
} from './appearance-settings';
import type { CustomThemeRecord } from '../../shared/contracts';
import { sanitizeCustomCss } from './custom-css';

export interface ThemeTokens {
  readonly background: string;
  readonly panel: string;
  readonly surface: string;
  readonly text: string;
  readonly mutedText: string;
  readonly border: string;
  readonly accent: string;
  readonly accentContrast: string;
  readonly codeBackground: string;
  readonly selection: string;
  readonly link: string;
  readonly blockquote: string;
  readonly tableStripe: string;
}

export interface BuiltInTheme {
  readonly id: BuiltInThemeId;
  readonly label: string;
  readonly description: string;
  readonly light: ThemeTokens;
  readonly dark: ThemeTokens;
}

const markoraLight: ThemeTokens = {
  background: '#fafafa',
  panel: '#f0f0f0',
  surface: '#ffffff',
  text: '#222222',
  mutedText: '#666666',
  border: '#e0e0e0',
  accent: '#107c41',
  accentContrast: '#ffffff',
  codeBackground: '#f5f5f5',
  selection: '#cce3d6',
  link: '#107c41',
  blockquote: '#666666',
  tableStripe: '#fafafa',
};

const markoraDark: ThemeTokens = {
  background: '#181818',
  panel: '#202020',
  surface: '#1e1e1e',
  text: '#e0e0e0',
  mutedText: '#888888',
  border: '#333333',
  accent: '#3fb950',
  accentContrast: '#102019',
  codeBackground: '#252525',
  selection: '#2c5a38',
  link: '#58a6ff',
  blockquote: '#888888',
  tableStripe: '#252525',
};

export const BUILT_IN_THEMES: readonly BuiltInTheme[] = [
  {
    id: 'markora',
    label: 'Markora Clean',
    description: 'Neutral white document, modern sans-serif typography, and minimal borders.',
    light: markoraLight,
    dark: markoraDark,
  },
  {
    id: 'white',
    label: 'Markora White',
    description: 'A bright, paper-like writing surface with calm typography and focused contrast.',
    light: {
      // Typora-inspired Classic White palette: a true white writing canvas,
      // restrained chrome, neutral ink, and GitHub-like blue links.
      background: '#ffffff',
      panel: '#f7f7f7',
      surface: '#ffffff',
      text: '#2b2b2b',
      mutedText: '#6b6f73',
      border: '#e5e5e5',
      // Darkened one step from Typora's familiar blue so normal-size links
      // remain WCAG AA against the white canvas.
      accent: '#2f6f9f',
      accentContrast: '#ffffff',
      codeBackground: '#f6f8fa',
      selection: '#cfe8ff',
      link: '#2f6f9f',
      blockquote: '#6b6f73',
      tableStripe: '#fafafa',
    },
    dark: {
      background: '#15181a',
      panel: '#1d2225',
      surface: '#181c1f',
      text: '#e8edf0',
      mutedText: '#9aa7ae',
      border: '#30383d',
      accent: '#75d5a0',
      accentContrast: '#10251a',
      codeBackground: '#20262a',
      selection: '#28563d',
      link: '#8be0b0',
      blockquote: '#9aa7ae',
      tableStripe: '#20262a',
    },
  },
  {
    id: 'paper',
    label: 'Markora Paper',
    description: 'Warm paper tones for long-form prose and editorial layout.',
    light: {
      background: '#f6f4f0',
      panel: '#eceae2',
      surface: '#fdfcf7',
      text: '#332c22',
      mutedText: '#5e584f',
      border: '#d8d6cc',
      accent: '#8c6239',
      accentContrast: '#ffffff',
      codeBackground: '#f6f4f0',
      selection: '#f3e4d5',
      link: '#8c6239',
      blockquote: '#8c6239',
      tableStripe: '#f6f4f0',
    },
    dark: {
      background: '#1e1b18',
      panel: '#2a2521',
      surface: '#24201c',
      text: '#f4eae1',
      mutedText: '#a2978d',
      border: '#3e3832',
      accent: '#dca060',
      accentContrast: '#29190e',
      codeBackground: '#2a2521',
      selection: '#5a4531',
      link: '#dca060',
      blockquote: '#dca060',
      tableStripe: '#2a2521',
    },
  },
  {
    id: 'academic',
    label: 'Markora Academic',
    description: 'Traditional layout, high legibility, and precise spacing for academic articles.',
    light: {
      background: '#fcfcfc',
      panel: '#f3f3f3',
      surface: '#ffffff',
      text: '#111111',
      mutedText: '#555555',
      border: '#d0d0d0',
      accent: '#003366',
      accentContrast: '#ffffff',
      codeBackground: '#f7f7f7',
      selection: '#d6e4f0',
      link: '#003366',
      blockquote: '#555555',
      tableStripe: '#f7f7f7',
    },
    dark: {
      background: '#0f1216',
      panel: '#161b22',
      surface: '#0d1117',
      text: '#c9d1d9',
      mutedText: '#8b949e',
      border: '#30363d',
      accent: '#58a6ff',
      accentContrast: '#0a1524',
      codeBackground: '#161b22',
      selection: '#1f6feb',
      link: '#58a6ff',
      blockquote: '#8b949e',
      tableStripe: '#161b22',
    },
  },
  {
    id: 'sepia',
    label: 'Markora Sepia',
    description: 'Warm cream backgrounds with reduced blue light for comfortable long reading.',
    light: {
      background: '#f4ecd8',
      panel: '#e6dbbf',
      surface: '#faf4e8',
      text: '#433422',
      mutedText: '#7d6a54',
      border: '#d5c7a9',
      accent: '#a05a2c',
      accentContrast: '#ffffff',
      codeBackground: '#f4ecd8',
      selection: '#eedcb5',
      link: '#a05a2c',
      blockquote: '#7d6a54',
      tableStripe: '#f4ecd8',
    },
    dark: {
      background: '#2b2013',
      panel: '#382a1a',
      surface: '#302416',
      text: '#ecd6b5',
      mutedText: '#aa9175',
      border: '#4e3c27',
      accent: '#e29456',
      accentContrast: '#21170d',
      codeBackground: '#382a1a',
      selection: '#704e28',
      link: '#e29456',
      blockquote: '#aa9175',
      tableStripe: '#382a1a',
    },
  },
  {
    id: 'graphite',
    label: 'Markora Graphite',
    description: 'Neutral gray interface with low contrast for focused drafting.',
    light: {
      background: '#f0f0f0',
      panel: '#e2e2e2',
      surface: '#fafafa',
      text: '#2b2b2b',
      mutedText: '#6c6c6c',
      border: '#d2d2d2',
      accent: '#4a4a4a',
      accentContrast: '#ffffff',
      codeBackground: '#f0f0f0',
      selection: '#dcdcdc',
      link: '#4a4a4a',
      blockquote: '#6c6c6c',
      tableStripe: '#f0f0f0',
    },
    dark: {
      background: '#202020',
      panel: '#2b2b2b',
      surface: '#242424',
      text: '#e2e2e2',
      mutedText: '#909090',
      border: '#383838',
      accent: '#b0b0b0',
      accentContrast: '#181818',
      codeBackground: '#2b2b2b',
      selection: '#444444',
      link: '#b0b0b0',
      blockquote: '#909090',
      tableStripe: '#2b2b2b',
    },
  },
  {
    id: 'forest',
    label: 'Markora Forest',
    description: 'Low-glare green shades inspired by woodland settings.',
    light: {
      background: '#edf3eb',
      panel: '#dfe9dd',
      surface: '#f8fcf6',
      text: '#1c3021',
      mutedText: '#5b7160',
      border: '#c4d4c5',
      accent: '#2d6a3f',
      accentContrast: '#ffffff',
      codeBackground: '#edf3eb',
      selection: '#b8d9bd',
      link: '#28633a',
      blockquote: '#507b5b',
      tableStripe: '#edf5eb',
    },
    dark: {
      background: '#101912',
      panel: '#17251a',
      surface: '#142018',
      text: '#e4f0e5',
      mutedText: '#91a995',
      border: '#29412f',
      accent: '#78ce88',
      accentContrast: '#102415',
      codeBackground: '#17251a',
      selection: '#315e3b',
      link: '#8bd99a',
      blockquote: '#70a77a',
      tableStripe: '#19281c',
    },
  },
  {
    id: 'midnight',
    label: 'Markora Midnight',
    description: 'Cool blue elements with clean violet indicators.',
    light: {
      background: '#edf1f7',
      panel: '#dfe5f0',
      surface: '#f8faff',
      text: '#1e293b',
      mutedText: '#64748b',
      border: '#cbd5e1',
      accent: '#4f46e5',
      accentContrast: '#ffffff',
      codeBackground: '#edf1f7',
      selection: '#e0e7ff',
      link: '#4f46e5',
      blockquote: '#64748b',
      tableStripe: '#edf1f7',
    },
    dark: {
      background: '#090b10',
      panel: '#11131c',
      surface: '#0d0e16',
      text: '#f8fafc',
      mutedText: '#94a3b8',
      border: '#1e293b',
      accent: '#818cf8',
      accentContrast: '#11131c',
      codeBackground: '#11131c',
      selection: '#312e81',
      link: '#818cf8',
      blockquote: '#94a3b8',
      tableStripe: '#11131c',
    },
  },
  {
    id: 'high-contrast',
    label: 'Markora High Contrast',
    description: 'Maximum contrast elements complying with accessibility protocols.',
    light: {
      background: '#ffffff',
      panel: '#f0f0f0',
      surface: '#ffffff',
      text: '#000000',
      mutedText: '#444444',
      border: '#000000',
      accent: '#0000ff',
      accentContrast: '#ffffff',
      codeBackground: '#eeeeee',
      selection: '#ffff00',
      link: '#0000ff',
      blockquote: '#000000',
      tableStripe: '#f0f0f0',
    },
    dark: {
      background: '#000000',
      panel: '#1a1a1a',
      surface: '#000000',
      text: '#ffffff',
      mutedText: '#cccccc',
      border: '#ffffff',
      accent: '#00ffff',
      accentContrast: '#000000',
      codeBackground: '#161616',
      selection: '#00ffff',
      link: '#00ffff',
      blockquote: '#ffffff',
      tableStripe: '#1a1a1a',
    },
  },
];

export function resolveColorMode(mode: ColorMode, prefersDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

export function resolveBuiltInTheme(
  id: BuiltInThemeId,
  mode: ColorMode,
  prefersDark: boolean,
): { readonly definition: BuiltInTheme; readonly mode: 'light' | 'dark'; readonly tokens: ThemeTokens } {
  const definition = BUILT_IN_THEMES.find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0];
  const resolvedMode = resolveColorMode(mode, prefersDark);
  return { definition, mode: resolvedMode, tokens: definition[resolvedMode] };
}

export function appearanceCssVariables(
  settings: AppearanceSettings,
  prefersDark: boolean,
  customThemes: readonly CustomThemeRecord[] = [],
): Readonly<Record<string, string>> {
  const uiThemeId = settings.theme.uiThemeId ?? settings.theme.builtInTheme;
  const selectedDocumentTheme = settings.theme.documentThemeId ?? settings.theme.documentTheme;
  const docThemeId =
    selectedDocumentTheme === 'adaptive' || !selectedDocumentTheme ? uiThemeId : selectedDocumentTheme;

  const uiTokens = resolveThemeSelection(uiThemeId, settings.theme.colorMode, prefersDark, customThemes);
  const docTokens = resolveThemeSelection(docThemeId, settings.theme.colorMode, prefersDark, customThemes);

  const linkDecoration = settings.elements.links === 'underline' ? 'underline' : 'none';
  const codeRadius = settings.elements.codeBlocks === 'flat' ? '0px' : '8px';
  const codeShadow = settings.elements.codeBlocks === 'elevated' ? '0 5px 18px rgb(0 0 0 / 16%)' : 'none';

  return {
    // Legacy mapping (to keep existing styles functional)
    '--markora-bg': uiTokens.background,
    '--markora-panel': uiTokens.panel,
    '--markora-surface': uiTokens.surface,
    '--markora-text': uiTokens.text,
    '--markora-muted': uiTokens.mutedText,
    '--markora-border': uiTokens.border,
    '--markora-accent': uiTokens.accent,
    '--markora-accent-contrast': uiTokens.accentContrast,
    '--markora-code-bg': docTokens.codeBackground,
    '--markora-selection': docTokens.selection,
    '--markora-link': docTokens.link,
    '--markora-blockquote': docTokens.blockquote,
    '--markora-table-stripe': docTokens.tableStripe,
    '--markora-editor-font': settings.typography.editorFont,
    '--markora-code-font': settings.typography.codeFont,
    '--markora-font-size': `${settings.typography.fontSize}px`,
    '--markora-line-height': String(settings.typography.lineHeight),
    '--markora-paragraph-spacing': `${settings.typography.paragraphSpacing}px`,
    '--markora-heading-spacing': `${settings.typography.headingSpacing}px`,
    '--markora-editor-padding': `${settings.typography.editorPadding}px`,
    '--markora-editor-width': `${settings.writing.editorWidth}px`,
    '--markora-content-width': `${settings.writing.contentWidth}px`,
    '--markora-link-decoration': linkDecoration,
    '--markora-code-radius': codeRadius,
    '--markora-code-shadow': codeShadow,

    // Core Layout Variables
    '--bg': uiTokens.background,
    '--panel': uiTokens.panel,
    '--surface': uiTokens.surface,
    '--ink': uiTokens.text,
    '--muted': uiTokens.mutedText,
    '--line': uiTokens.border,
    '--accent': uiTokens.accent,
    '--code': docTokens.codeBackground,
    '--font-size': `${settings.typography.fontSize}px`,
    '--line-height': String(settings.typography.lineHeight),
    '--content-width': `${settings.writing.contentWidth}px`,

    // Centralized Design Tokens (Surfaces)
    '--ui-window-bg': uiTokens.background,
    '--ui-sidebar-bg': uiTokens.panel,
    '--ui-editor-bg': uiTokens.surface,
    '--ui-dialog-bg': uiTokens.surface,
    '--ui-popover-bg': uiTokens.surface,
    '--ui-hover-bg': `color-mix(in srgb, ${uiTokens.accent} 12%, transparent)`,
    '--ui-active-bg': `color-mix(in srgb, ${uiTokens.accent} 16%, transparent)`,
    '--ui-selected-bg': uiTokens.selection,

    // Centralized Design Tokens (Text)
    '--ui-text-primary': uiTokens.text,
    '--ui-text-secondary': uiTokens.mutedText,
    '--ui-text-muted': uiTokens.mutedText,
    '--ui-text-disabled': `color-mix(in srgb, ${uiTokens.text} 35%, transparent)`,
    '--ui-link': uiTokens.link,
    '--ui-selection-text': uiTokens.text,

    // Centralized Design Tokens (Borders)
    '--ui-border-subtle': uiTokens.border,
    '--ui-border-default': uiTokens.border,
    '--ui-border-strong': `color-mix(in srgb, ${uiTokens.text} 45%, transparent)`,
    '--ui-focus-ring': uiTokens.accent,

    // Centralized Design Tokens (Document)
    '--doc-bg': docTokens.surface,
    '--doc-text': docTokens.text,
    '--doc-heading': docTokens.text,
    '--doc-link': docTokens.link,
    '--doc-muted': docTokens.mutedText,
    '--doc-code-bg': docTokens.codeBackground,
    '--doc-code-text': docTokens.text,
    '--doc-quote-border': docTokens.blockquote,
    '--doc-quote-text': docTokens.mutedText,
    '--doc-table-border': docTokens.border,
    '--doc-selection-bg': docTokens.selection,

    // Centralized Design Tokens (Typography)
    '--ui-font-family': `'Segoe UI', system-ui, sans-serif`,
    '--doc-font-family': settings.typography.editorFont,
    '--heading-font-family': settings.typography.editorFont,
    '--code-font-family': settings.typography.codeFont,
    '--doc-font-size': `${settings.typography.fontSize}px`,
    '--doc-line-height': String(settings.typography.lineHeight),
    '--doc-paragraph-spacing': `${settings.typography.paragraphSpacing}px`,
    '--doc-content-width': `${settings.writing.contentWidth}px`,

    // Centralized Design Tokens (Geometry)
    '--radius-small': '4px',
    '--radius-medium': '8px',
    '--radius-large': '12px',
    '--sidebar-width': '260px',
    '--titlebar-height': '34px',
    '--tabbar-height': '34px',
    '--statusbar-height': '24px',

    // Centralized Design Tokens (Shadows)
    '--shadow-popover': '0 4px 18px rgba(0, 0, 0, 0.15)',
    '--shadow-dialog': '0 24px 80px rgba(0, 0, 0, 0.35)',
    '--shadow-menu': '0 8px 30px rgba(0, 0, 0, 0.2)',

    // Shared modal tokens. These deliberately resolve from the application
    // theme only; document-only themes must never recolor a modal surface.
    '--dialog-bg': uiTokens.surface,
    '--dialog-text-primary': uiTokens.text,
    '--dialog-text-secondary': uiTokens.mutedText,
    '--dialog-border': uiTokens.border,
    '--dialog-shadow': '0 24px 72px rgb(0 0 0 / 42%), 0 4px 18px rgb(0 0 0 / 18%)',
    '--dialog-overlay':
      resolveColorMode(settings.theme.colorMode, prefersDark) === 'dark'
        ? 'rgb(0 0 0 / 62%)'
        : 'rgb(15 23 42 / 35%)',
    '--dialog-input-bg': uiTokens.background,
    '--dialog-input-text': uiTokens.text,
    '--dialog-input-placeholder': uiTokens.mutedText,
    '--dialog-input-border': uiTokens.border,
    '--dialog-input-border-focus': uiTokens.accent,
    '--dialog-primary-bg': uiTokens.accent,
    '--dialog-primary-text': uiTokens.accentContrast,
    '--dialog-primary-hover': `color-mix(in srgb, ${uiTokens.accent} 86%, ${uiTokens.text})`,
    '--dialog-secondary-text': uiTokens.text,
    '--dialog-secondary-hover': `color-mix(in srgb, ${uiTokens.accent} 12%, transparent)`,
    '--dialog-danger-bg': '#b42318',
    '--dialog-focus-ring': uiTokens.accent,
  };
}

/**
 * UI-only variables for the body-mounted dialog portal. Document variables
 * are intentionally excluded so custom document themes cannot leak into
 * application controls rendered outside the `.app` element.
 */
export function appearanceApplicationCssVariables(
  settings: AppearanceSettings,
  prefersDark: boolean,
  customThemes: readonly CustomThemeRecord[] = [],
): Readonly<Record<string, string>> {
  const all = appearanceCssVariables(settings, prefersDark, customThemes);
  const names = [
    '--bg',
    '--panel',
    '--surface',
    '--ink',
    '--muted',
    '--line',
    '--accent',
    '--accent-contrast',
    '--font-size',
    '--line-height',
    '--content-width',
    '--ui-window-bg',
    '--ui-sidebar-bg',
    '--ui-editor-bg',
    '--ui-dialog-bg',
    '--ui-popover-bg',
    '--ui-hover-bg',
    '--ui-active-bg',
    '--ui-selected-bg',
    '--ui-text-primary',
    '--ui-text-secondary',
    '--ui-text-muted',
    '--ui-text-disabled',
    '--ui-link',
    '--ui-selection-text',
    '--ui-border-subtle',
    '--ui-border-default',
    '--ui-border-strong',
    '--ui-focus-ring',
    '--ui-font-family',
    '--radius-small',
    '--radius-medium',
    '--radius-large',
    '--shadow-popover',
    '--shadow-dialog',
    '--shadow-menu',
    '--dialog-bg',
    '--dialog-text-primary',
    '--dialog-text-secondary',
    '--dialog-border',
    '--dialog-shadow',
    '--dialog-overlay',
    '--dialog-input-bg',
    '--dialog-input-text',
    '--dialog-input-placeholder',
    '--dialog-input-border',
    '--dialog-input-border-focus',
    '--dialog-primary-bg',
    '--dialog-primary-text',
    '--dialog-primary-hover',
    '--dialog-secondary-text',
    '--dialog-secondary-hover',
    '--dialog-danger-bg',
    '--dialog-focus-ring',
  ];
  return Object.fromEntries(
    names.map((name) => [name, all[name]]).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

/** Variables scoped to the document surface so a document theme never recolors shell chrome. */
export function appearanceDocumentCssVariables(
  settings: AppearanceSettings,
  prefersDark: boolean,
  customThemes: readonly CustomThemeRecord[] = [],
): Readonly<Record<string, string>> {
  const selectedDocumentTheme = settings.theme.documentThemeId ?? settings.theme.documentTheme;
  const uiThemeId = settings.theme.uiThemeId ?? settings.theme.builtInTheme;
  const documentThemeId =
    selectedDocumentTheme === 'adaptive' || !selectedDocumentTheme ? uiThemeId : selectedDocumentTheme;
  const tokens = resolveThemeSelection(documentThemeId, settings.theme.colorMode, prefersDark, customThemes);
  return {
    '--markora-bg': tokens.background,
    '--markora-panel': tokens.panel,
    '--markora-surface': tokens.surface,
    '--markora-text': tokens.text,
    '--markora-muted': tokens.mutedText,
    '--markora-border': tokens.border,
    '--markora-accent': tokens.accent,
    '--markora-accent-contrast': tokens.accentContrast,
    '--markora-code-bg': tokens.codeBackground,
    '--markora-selection': tokens.selection,
    '--markora-link': tokens.link,
    '--markora-blockquote': tokens.blockquote,
    '--markora-table-stripe': tokens.tableStripe,
    '--doc-bg': tokens.surface,
    '--doc-text': tokens.text,
    '--doc-heading': tokens.text,
    '--doc-link': tokens.link,
    '--doc-muted': tokens.mutedText,
    '--doc-code-bg': tokens.codeBackground,
    '--doc-code-text': tokens.text,
    '--doc-quote-border': tokens.blockquote,
    '--doc-quote-text': tokens.mutedText,
    '--doc-table-border': tokens.border,
    '--doc-selection-bg': tokens.selection,
    '--doc-font-family': settings.typography.editorFont,
    '--heading-font-family': settings.typography.editorFont,
    '--code-font-family': settings.typography.codeFont,
    '--doc-font-size': `${settings.typography.fontSize}px`,
    '--doc-line-height': String(settings.typography.lineHeight),
    '--doc-paragraph-spacing': `${settings.typography.paragraphSpacing}px`,
    '--doc-content-width': `${settings.writing.contentWidth}px`,
  };
}

/** Return only sanitized CSS belonging to the selected theme surfaces. */
export function appearanceCustomThemeCss(
  settings: AppearanceSettings,
  customThemes: readonly CustomThemeRecord[],
): string {
  const uiId = settings.theme.uiThemeId ?? settings.theme.builtInTheme;
  const documentId = settings.theme.documentThemeId ?? settings.theme.documentTheme;
  const ids = new Set<string>([uiId, documentId === 'adaptive' ? uiId : documentId]);
  return customThemes
    .filter((theme) => ids.has(theme.id) && theme.css)
    .map((theme) => sanitizeCustomCss(theme.css ?? '').css)
    .filter(Boolean)
    .join('\n');
}

/** Human-readable theme name for status text, menus, and accessibility labels. */
export function themeDisplayName(
  selection: ThemeSelectionId | string,
  customThemes: readonly CustomThemeRecord[] = [],
): string {
  if (selection === 'adaptive') return 'Adaptive';
  const custom = customThemes.find((theme) => theme.id === selection);
  if (custom) return custom.name;
  return BUILT_IN_THEMES.find((theme) => theme.id === selection)?.label ?? selection;
}

function resolveThemeSelection(
  selection: ThemeSelectionId | string,
  mode: ColorMode,
  prefersDark: boolean,
  customThemes: readonly CustomThemeRecord[],
): ThemeTokens {
  const custom = customThemes.find((theme) => theme.id === selection);
  if (custom) return mode === 'dark' || (mode === 'system' && prefersDark) ? custom.dark : custom.light;
  const builtIn = BUILT_IN_THEME_IDS.has(selection as BuiltInThemeId)
    ? (selection as BuiltInThemeId)
    : 'markora';
  return resolveBuiltInTheme(builtIn, mode, prefersDark).tokens;
}

const BUILT_IN_THEME_IDS = new Set<BuiltInThemeId>(BUILT_IN_THEMES.map((theme) => theme.id));

export type ZenRegion = keyof ZenHiddenRegions;

export function hiddenZenRegions(settings: AppearanceSettings): readonly ZenRegion[] {
  if (!settings.writing.zenMode) return [];
  return (Object.entries(settings.writing.zenHidden) as Array<[ZenRegion, boolean]>)
    .filter(([, hidden]) => hidden)
    .map(([region]) => region);
}

export function appearanceClassNames(settings: AppearanceSettings): readonly string[] {
  const classes = ['markora-appearance-root'];
  if (settings.writing.focusMode) classes.push('markora-focus-mode');
  if (settings.writing.typewriterMode) classes.push('markora-typewriter-mode');
  if (settings.writing.zenMode) classes.push('markora-zen-mode');
  if (settings.writing.scrollPastEnd) classes.push('markora-scroll-past-end');
  classes.push(settings.writing.wordWrap ? 'markora-word-wrap' : 'markora-no-wrap');
  for (const region of hiddenZenRegions(settings)) classes.push(`markora-hide-${region}`);
  classes.push(`markora-links-${settings.elements.links}`);
  classes.push(`markora-tables-${settings.elements.tables}`);
  classes.push(`markora-blockquotes-${settings.elements.blockquotes}`);
  classes.push(`markora-code-${settings.elements.codeBlocks}`);
  classes.push(`markora-source-theme-${settings.theme.sourceTheme}`);
  classes.push(`markora-code-theme-${settings.theme.codeTheme}`);
  classes.push(`markora-mermaid-theme-${settings.theme.mermaidTheme}`);
  return classes;
}
