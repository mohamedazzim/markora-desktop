import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  createDefaultAppearanceSettings,
  exportAppearanceSettings,
  importAppearanceSettings,
  type AppearanceSettings,
  type BlockquoteAppearance,
  type BuiltInThemeId,
  type CodeAppearance,
  type CodeBlockTheme,
  type ColorMode,
  type LinkAppearance,
  type MermaidTheme,
  type SourceEditorTheme,
  type TableAppearance,
  type ThemeSelectionId,
  type ZenHiddenRegions,
} from './appearance-settings';
import type { CustomThemePackage, CustomThemeRecord } from '../../shared/contracts';
import { sanitizeCustomCss } from './custom-css';
import { BUILT_IN_THEMES, resolveBuiltInTheme } from './themes';
import { Dialog } from '../components/Dialog';
import { ThemeGallery } from './ThemeGallery';
import './appearance.css';

export interface AppearancePanelProps {
  readonly open: boolean;
  readonly settings: AppearanceSettings;
  readonly prefersDark: boolean;
  readonly onChange: (settings: AppearanceSettings) => void;
  readonly onClose: () => void;
  readonly onFullscreenChange?: (enabled: boolean) => void;
  /** File dialogs and writes remain parent-owned typed preload operations. */
  readonly onRequestImport?: () => Promise<string | null>;
  readonly onRequestExport?: (serializedSettings: string) => Promise<void> | void;
  readonly customThemes?: readonly CustomThemeRecord[];
  readonly onImportCustomTheme?: () => Promise<CustomThemeRecord | null>;
  readonly onDuplicateCustomTheme?: (id: string) => Promise<CustomThemeRecord>;
  readonly onDeleteCustomTheme?: (id: string) => Promise<void>;
  readonly onExportCustomTheme?: (id: string) => Promise<boolean>;
  readonly onSaveCustomTheme?: (theme: CustomThemePackage) => Promise<CustomThemeRecord>;
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function AppearancePanel({
  open,
  settings,
  prefersDark,
  onChange,
  onClose,
  onFullscreenChange,
  onRequestImport,
  onRequestExport,
  customThemes = [],
  onImportCustomTheme,
  onDuplicateCustomTheme,
  onDeleteCustomTheme,
  onExportCustomTheme,
  onSaveCustomTheme,
}: AppearancePanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [customCss, setCustomCss] = useState(settings.theme.customCss);
  const [messages, setMessages] = useState<readonly string[]>([]);
  const [messageKind, setMessageKind] = useState<'status' | 'error'>('status');
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustomCss(settings.theme.customCss);
  }, [open, settings.theme.customCss]);

  useEffect(() => {
    if (open) setMessages([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let active = true;
    queueMicrotask(() => {
      if (active) panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    });
    return () => {
      active = false;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const updateWriting = (update: Partial<AppearanceSettings['writing']>) =>
    onChange({ ...settings, writing: { ...settings.writing, ...update } });
  const updateTypography = (update: Partial<AppearanceSettings['typography']>) =>
    onChange({ ...settings, typography: { ...settings.typography, ...update } });
  const updateElements = (update: Partial<AppearanceSettings['elements']>) =>
    onChange({ ...settings, elements: { ...settings.elements, ...update } });
  const updateTheme = (update: Partial<AppearanceSettings['theme']>) =>
    onChange({ ...settings, theme: { ...settings.theme, ...update } });
  const updateZenHidden = (key: keyof ZenHiddenRegions, hidden: boolean) =>
    updateWriting({ zenHidden: { ...settings.writing.zenHidden, [key]: hidden } });

  const setFullscreen = (enabled: boolean) => {
    updateWriting({ fullscreen: enabled });
    onFullscreenChange?.(enabled);
  };

  const importTheme = async () => {
    if (!onRequestImport || busy) return;
    setBusy('import');
    setMessages([]);
    try {
      const serialized = await onRequestImport();
      if (serialized === null) return;
      const result = importAppearanceSettings(serialized);
      setCustomCss(result.settings.theme.customCss);
      setMessages(result.warnings.length > 0 ? result.warnings : ['Appearance settings imported.']);
      setMessageKind('status');
      onChange(result.settings);
      onFullscreenChange?.(result.settings.writing.fullscreen);
    } catch (cause) {
      setMessages([cause instanceof Error ? cause.message : 'Appearance settings could not be imported.']);
      setMessageKind('error');
    } finally {
      setBusy(null);
    }
  };

  const exportTheme = async () => {
    if (!onRequestExport || busy) return;
    setBusy('export');
    setMessages([]);
    try {
      await onRequestExport(exportAppearanceSettings(settings));
      setMessages(['Appearance settings exported.']);
      setMessageKind('status');
    } catch (cause) {
      setMessages([cause instanceof Error ? cause.message : 'Appearance settings could not be exported.']);
      setMessageKind('error');
    } finally {
      setBusy(null);
    }
  };

  const applyCustomCss = () => {
    const result = sanitizeCustomCss(customCss);
    if (!result.safe) {
      setMessages(result.issues.map((issue) => issue.message));
      setMessageKind('error');
      return;
    }
    setCustomCss(result.css);
    updateTheme({ customCss: result.css });
    setMessages(['Custom CSS validated, scoped, and applied.']);
    setMessageKind('status');
  };

  const reset = () => {
    const defaults = createDefaultAppearanceSettings();
    setCustomCss('');
    setMessages(['Appearance settings reset to defaults.']);
    setMessageKind('status');
    onChange(defaults);
    onFullscreenChange?.(false);
  };

  return (
    <Dialog
      open={open}
      contentRef={panelRef}
      className="appearance-panel"
      size="wide"
      closeOnBackdrop
      onClose={onClose}
      labelledBy={titleId}
      describedBy={`${descriptionId}${messages.length ? ` ${statusId}` : ''}`}
      initialFocus="[data-autofocus]"
    >
      <div>
        <header className="appearance-panel-header">
          <div>
            <h2 id={titleId}>Appearance and writing modes</h2>
            <p id={descriptionId}>Customize the writing environment without changing document content.</p>
          </div>
          <button type="button" aria-label="Close appearance settings" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="appearance-panel-body">
          {messages.length > 0 && (
            <div
              id={statusId}
              className={`appearance-message ${messageKind}`}
              role={messageKind === 'error' ? 'alert' : 'status'}
              aria-live={messageKind === 'error' ? 'assertive' : 'polite'}
            >
              {messages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}

          <details open>
            <summary>Writing modes</summary>
            <div className="appearance-section-grid">
              <label className="appearance-switch">
                <input
                  type="checkbox"
                  checked={settings.writing.focusMode}
                  onChange={(event) => updateWriting({ focusMode: event.target.checked })}
                />
                <span>Focus Mode</span>
                <small>Dim blocks except the active block.</small>
              </label>
              <label className="appearance-switch">
                <input
                  type="checkbox"
                  checked={settings.writing.typewriterMode}
                  onChange={(event) => updateWriting({ typewriterMode: event.target.checked })}
                />
                <span>Typewriter Mode</span>
                <small>Keep the active line or block near the center.</small>
              </label>
              <label className="appearance-switch">
                <input
                  type="checkbox"
                  checked={settings.writing.zenMode}
                  onChange={(event) => updateWriting({ zenMode: event.target.checked })}
                />
                <span>Zen Mode</span>
                <small>Hide selected interface regions.</small>
              </label>
              <label className="appearance-switch">
                <input
                  type="checkbox"
                  checked={settings.writing.fullscreen}
                  onChange={(event) => setFullscreen(event.target.checked)}
                />
                <span>Full screen</span>
                <small>Request native application full screen.</small>
              </label>
              <label className="appearance-switch">
                <input
                  type="checkbox"
                  checked={settings.writing.scrollPastEnd}
                  onChange={(event) => updateWriting({ scrollPastEnd: event.target.checked })}
                />
                <span>Scroll past end</span>
              </label>
              <label className="appearance-switch">
                <input
                  type="checkbox"
                  checked={settings.writing.wordWrap}
                  onChange={(event) => updateWriting({ wordWrap: event.target.checked })}
                />
                <span>Word wrap</span>
              </label>
            </div>

            <fieldset className="appearance-zen-regions" disabled={!settings.writing.zenMode}>
              <legend>Hide in Zen Mode</legend>
              {(
                [
                  ['workspaceSidebar', 'Workspace sidebar'],
                  ['outlineSidebar', 'Outline sidebar'],
                  ['toolbar', 'Toolbar'],
                  ['tabBar', 'Tab bar'],
                  ['statusBar', 'Status bar'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={settings.writing.zenHidden[key]}
                    onChange={(event) => updateZenHidden(key, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            <div className="appearance-field-grid">
              <label>
                Editor width (px)
                <input
                  type="number"
                  min="480"
                  max="2400"
                  value={settings.writing.editorWidth}
                  onChange={(event) =>
                    updateWriting({
                      editorWidth: numberValue(event.target.value, settings.writing.editorWidth),
                    })
                  }
                />
              </label>
              <label>
                Content width (px)
                <input
                  type="number"
                  min="320"
                  max="1600"
                  value={settings.writing.contentWidth}
                  onChange={(event) =>
                    updateWriting({
                      contentWidth: numberValue(event.target.value, settings.writing.contentWidth),
                    })
                  }
                />
              </label>
            </div>
          </details>

          <details open>
            <summary>Theme</summary>
            <div className="appearance-field-grid">
              <label>
                Color mode
                <select
                  data-autofocus
                  value={settings.theme.colorMode}
                  onChange={(event) => updateTheme({ colorMode: event.target.value as ColorMode })}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">Follow system</option>
                </select>
              </label>
              <label>
                Document theme
                <select
                  aria-label="Document theme selection"
                  value={settings.theme.documentThemeId ?? settings.theme.documentTheme}
                  onChange={(event) => {
                    const value = event.target.value as ThemeSelectionId;
                    updateTheme({ documentTheme: value, documentThemeId: value });
                  }}
                >
                  <option value="adaptive">Adaptive (interface theme)</option>
                  {BUILT_IN_THEMES.map((theme) => (
                    <option key={theme.id} value={theme.id}>{theme.label}</option>
                  ))}
                  {customThemes.map((theme) => (
                    <option key={theme.id} value={theme.id}>{theme.name}</option>
                  ))}
                </select>
                <small className="appearance-field-help">Change the paper and prose surface without recoloring the interface.</small>
              </label>
              <label>
                Source editor theme
                <select
                  value={settings.theme.sourceTheme}
                  onChange={(event) => updateTheme({ sourceTheme: event.target.value as SourceEditorTheme })}
                >
                  <option value="adaptive">Adaptive</option>
                  <option value="github-light">GitHub Light</option>
                  <option value="github-dark">GitHub Dark</option>
                  <option value="dracula">Dracula</option>
                </select>
              </label>
              <label>
                Code-block theme
                <select
                  value={settings.theme.codeTheme}
                  onChange={(event) => updateTheme({ codeTheme: event.target.value as CodeBlockTheme })}
                >
                  <option value="adaptive">Adaptive</option>
                  <option value="github">GitHub</option>
                  <option value="atom-one-dark">Atom One Dark</option>
                  <option value="monokai">Monokai</option>
                </select>
              </label>
              <label>
                Mermaid theme
                <select
                  value={settings.theme.mermaidTheme}
                  onChange={(event) => updateTheme({ mermaidTheme: event.target.value as MermaidTheme })}
                >
                  <option value="default">Default</option>
                  <option value="neutral">Neutral</option>
                  <option value="dark">Dark</option>
                  <option value="forest">Forest</option>
                  <option value="base">Base</option>
                </select>
              </label>
            </div>

            <fieldset className="appearance-theme-list">
              <legend>Built-in theme preview</legend>
              {BUILT_IN_THEMES.map((theme) => {
                const activeInterfaceThemeId = settings.theme.uiThemeId ?? settings.theme.builtInTheme;
                const resolved = resolveBuiltInTheme(theme.id, settings.theme.colorMode, prefersDark);
                const previewStyle = {
                  '--preview-bg': resolved.tokens.background,
                  '--preview-surface': resolved.tokens.surface,
                  '--preview-text': resolved.tokens.text,
                  '--preview-muted': resolved.tokens.mutedText,
                  '--preview-accent': resolved.tokens.accent,
                  '--preview-border': resolved.tokens.border,
                } as CSSProperties;
                return (
                  <label key={theme.id} className="appearance-theme-card" style={previewStyle}>
                    <input
                      type="radio"
                      name="built-in-theme"
                      value={theme.id}
                      checked={activeInterfaceThemeId === theme.id}
                      onChange={() => updateTheme({ builtInTheme: theme.id as BuiltInThemeId, uiThemeId: theme.id as BuiltInThemeId })}
                    />
                    <span className="appearance-theme-swatch" aria-hidden="true">
                      <i />
                      <b />
                      <em />
                    </span>
                    <strong>
                      {theme.label}
                      {activeInterfaceThemeId === theme.id ? <span className="appearance-theme-active">Active</span> : null}
                    </strong>
                    <small>{theme.description}</small>
                  </label>
                );
              })}
            </fieldset>
          </details>

          <ThemeGallery
            settings={settings}
            prefersDark={prefersDark}
            customThemes={customThemes}
            includeBuiltIns
            onChange={onChange}
            onImport={onImportCustomTheme}
            onDuplicate={onDuplicateCustomTheme}
            onDelete={onDeleteCustomTheme}
            onExport={onExportCustomTheme}
            onSave={onSaveCustomTheme}
          />

          <details>
            <summary>Typography and elements</summary>
            <div className="appearance-field-grid">
              <label className="appearance-span-two">
                Editor font
                <input
                  value={settings.typography.editorFont}
                  onChange={(event) => updateTypography({ editorFont: event.target.value })}
                />
              </label>
              <label className="appearance-span-two">
                Code font
                <input
                  value={settings.typography.codeFont}
                  onChange={(event) => updateTypography({ codeFont: event.target.value })}
                />
              </label>
              <label>
                Font size (px)
                <input
                  type="number"
                  min="10"
                  max="48"
                  value={settings.typography.fontSize}
                  onChange={(event) =>
                    updateTypography({
                      fontSize: numberValue(event.target.value, settings.typography.fontSize),
                    })
                  }
                />
              </label>
              <label>
                Line height
                <input
                  type="number"
                  min="1"
                  max="3"
                  step="0.05"
                  value={settings.typography.lineHeight}
                  onChange={(event) =>
                    updateTypography({
                      lineHeight: numberValue(event.target.value, settings.typography.lineHeight),
                    })
                  }
                />
              </label>
              <label>
                Paragraph spacing (px)
                <input
                  type="number"
                  min="0"
                  max="80"
                  value={settings.typography.paragraphSpacing}
                  onChange={(event) =>
                    updateTypography({
                      paragraphSpacing: numberValue(event.target.value, settings.typography.paragraphSpacing),
                    })
                  }
                />
              </label>
              <label>
                Heading spacing (px)
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={settings.typography.headingSpacing}
                  onChange={(event) =>
                    updateTypography({
                      headingSpacing: numberValue(event.target.value, settings.typography.headingSpacing),
                    })
                  }
                />
              </label>
              <label>
                Editor padding (px)
                <input
                  type="number"
                  min="0"
                  max="160"
                  value={settings.typography.editorPadding}
                  onChange={(event) =>
                    updateTypography({
                      editorPadding: numberValue(event.target.value, settings.typography.editorPadding),
                    })
                  }
                />
              </label>
              <label>
                Link appearance
                <select
                  value={settings.elements.links}
                  onChange={(event) => updateElements({ links: event.target.value as LinkAppearance })}
                >
                  <option value="underline">Underlined</option>
                  <option value="subtle">Subtle</option>
                  <option value="accent">Accent</option>
                </select>
              </label>
              <label>
                Table appearance
                <select
                  value={settings.elements.tables}
                  onChange={(event) => updateElements({ tables: event.target.value as TableAppearance })}
                >
                  <option value="grid">Grid</option>
                  <option value="minimal">Minimal</option>
                  <option value="striped">Striped</option>
                </select>
              </label>
              <label>
                Blockquote appearance
                <select
                  value={settings.elements.blockquotes}
                  onChange={(event) =>
                    updateElements({ blockquotes: event.target.value as BlockquoteAppearance })
                  }
                >
                  <option value="bar">Accent bar</option>
                  <option value="boxed">Boxed</option>
                  <option value="italic">Italic</option>
                </select>
              </label>
              <label>
                Code-block appearance
                <select
                  value={settings.elements.codeBlocks}
                  onChange={(event) => updateElements({ codeBlocks: event.target.value as CodeAppearance })}
                >
                  <option value="flat">Flat</option>
                  <option value="rounded">Rounded</option>
                  <option value="elevated">Elevated</option>
                </select>
              </label>
            </div>
          </details>

          <details>
            <summary>Custom CSS and portability</summary>
            <label className="appearance-custom-css">
              Editor custom CSS
              <textarea
                aria-label="Editor custom CSS"
                value={customCss}
                onChange={(event) => setCustomCss(event.target.value)}
                placeholder={'p {\n  max-width: 70ch;\n}'}
                spellCheck={false}
              />
              <small>Only editor-scoped selectors and safe visual properties are accepted.</small>
            </label>
            <div className="appearance-button-row">
              <button type="button" onClick={applyCustomCss}>
                Validate and apply CSS
              </button>
              <button
                type="button"
                onClick={() => void importTheme()}
                disabled={!onRequestImport || busy !== null}
              >
                {busy === 'import' ? 'Importing…' : 'Import theme…'}
              </button>
              <button
                type="button"
                onClick={() => void exportTheme()}
                disabled={!onRequestExport || busy !== null}
              >
                {busy === 'export' ? 'Exporting…' : 'Export theme…'}
              </button>
              <button type="button" onClick={reset}>
                Reset appearance
              </button>
            </div>
          </details>
        </div>
      </div>
    </Dialog>
  );
}
