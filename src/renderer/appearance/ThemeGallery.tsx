import { useMemo, useState, type CSSProperties } from 'react';
import type { CustomThemePackage, CustomThemeRecord } from '../../shared/contracts';
import type { AppearanceSettings, ThemeSelectionId } from './appearance-settings';
import { BUILT_IN_THEMES, themeDisplayName, type ThemeTokens } from './themes';
import './theme-gallery.css';

export interface ThemeGalleryProps {
  readonly settings: AppearanceSettings;
  readonly prefersDark: boolean;
  readonly customThemes: readonly CustomThemeRecord[];
  readonly onChange: (settings: AppearanceSettings) => void;
  readonly onImport?: () => Promise<CustomThemeRecord | null>;
  readonly onDuplicate?: (id: string) => Promise<CustomThemeRecord>;
  readonly onDelete?: (id: string) => Promise<void>;
  readonly onExport?: (id: string) => Promise<boolean>;
  readonly onSave?: (theme: CustomThemePackage) => Promise<CustomThemeRecord>;
  readonly includeBuiltIns?: boolean;
}

function previewStyle(tokens: ThemeTokens): CSSProperties {
  return {
    '--theme-preview-bg': tokens.surface,
    '--theme-preview-panel': tokens.panel,
    '--theme-preview-text': tokens.text,
    '--theme-preview-muted': tokens.mutedText,
    '--theme-preview-accent': tokens.accent,
    '--theme-preview-border': tokens.border,
  } as CSSProperties;
}

export function ThemeGallery({
  settings,
  prefersDark,
  customThemes,
  onChange,
  onImport,
  onDuplicate,
  onDelete,
  onExport,
  onSave,
  includeBuiltIns = true,
}: ThemeGalleryProps) {
  const [scope, setScope] = useState<'interface' | 'document'>('interface');
  const [editing, setEditing] = useState<CustomThemeRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const resolvedMode = settings.theme.colorMode === 'dark' || (settings.theme.colorMode === 'system' && prefersDark) ? 'dark' : 'light';
  const activeId = scope === 'interface'
    ? settings.theme.uiThemeId ?? settings.theme.builtInTheme
    : settings.theme.documentThemeId ?? settings.theme.documentTheme;
  const customById = useMemo(() => new Map(customThemes.map((theme) => [theme.id, theme])), [customThemes]);

  const selectTheme = (id: ThemeSelectionId) => {
    if (scope === 'interface') {
      const builtIn = BUILT_IN_THEMES.some((theme) => theme.id === id) ? (id as AppearanceSettings['theme']['builtInTheme']) : settings.theme.builtInTheme;
      onChange({ ...settings, theme: { ...settings.theme, uiThemeId: id, builtInTheme: builtIn } });
    } else {
      onChange({ ...settings, theme: { ...settings.theme, documentThemeId: id, documentTheme: id } });
    }
  };
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); } finally { setBusy(null); }
  };

  return (
    <section className="theme-gallery" aria-label="Theme gallery">
      <div className="theme-gallery-toolbar">
        <div>
          <h3>Theme gallery</h3>
          <p>
            Active {scope} theme:{' '}
            <strong>
              {themeDisplayName(
                scope === 'interface'
                  ? (settings.theme.uiThemeId ?? settings.theme.builtInTheme)
                  : (settings.theme.documentThemeId ?? settings.theme.documentTheme),
                customThemes,
              )}
            </strong>
            . Preview the interface and document surface independently.
          </p>
        </div>
        <div className="theme-gallery-scope" role="group" aria-label="Theme scope">
          <button type="button" className={scope === 'interface' ? 'active' : ''} aria-pressed={scope === 'interface'} onClick={() => setScope('interface')}>Interface</button>
          <button type="button" className={scope === 'document' ? 'active' : ''} aria-pressed={scope === 'document'} onClick={() => setScope('document')}>Document</button>
        </div>
      </div>

      <div className="theme-gallery-grid" role="list" aria-label={`${scope} themes`}>
        {includeBuiltIns ? BUILT_IN_THEMES.map((theme) => {
          const tokens = theme[resolvedMode];
          const selected = activeId === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              role="listitem"
              className={`theme-gallery-card ${selected ? 'active' : ''}`}
              aria-pressed={selected}
              onClick={() => selectTheme(theme.id)}
              style={previewStyle(tokens)}
            >
              <span className="theme-gallery-preview" aria-hidden="true">
                <strong>Heading</strong>
                <span>Readable prose with <u>links</u> and emphasis.</span>
                <em>blockquote and code</em>
                <i />
              </span>
              <span className="theme-gallery-card-copy"><strong>{theme.label}</strong><small>{theme.description}</small></span>
              {selected ? <span className="theme-gallery-active">Active</span> : null}
            </button>
          );
        }) : null}
        {customThemes.map((theme) => {
          const tokens = theme[resolvedMode];
          const selected = activeId === theme.id;
          return (
            <div key={theme.id} className={`theme-gallery-card custom ${selected ? 'active' : ''}`} style={previewStyle(tokens)} role="listitem">
              <button type="button" className="theme-gallery-card-select" aria-pressed={selected} onClick={() => selectTheme(theme.id as ThemeSelectionId)}>
                <span className="theme-gallery-preview" aria-hidden="true"><strong>Heading</strong><span>Custom document preview with <u>links</u>.</span><em>blockquote and code</em><i /></span>
                <span className="theme-gallery-card-copy"><strong>{theme.name}</strong><small>{theme.description || 'Custom Markora theme'}</small></span>
                {selected ? <span className="theme-gallery-active">Active</span> : null}
              </button>
              <div className="theme-gallery-card-actions" aria-label={`${theme.name} actions`}>
                <button type="button" onClick={() => setEditing(theme)}>Edit</button>
                <button type="button" disabled={!onDuplicate || busy !== null} onClick={() => onDuplicate && void run(`duplicate-${theme.id}`, async () => { await onDuplicate(theme.id); })}>Duplicate</button>
                <button type="button" disabled={!onExport || busy !== null} onClick={() => onExport && void run(`export-${theme.id}`, async () => { await onExport(theme.id); })}>Export</button>
                <button type="button" className="danger" disabled={!onDelete || busy !== null} onClick={() => onDelete && void run(`delete-${theme.id}`, async () => { await onDelete(theme.id); })}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="theme-gallery-actions">
        <button type="button" disabled={!onImport || busy !== null} onClick={() => onImport && void run('import', async () => { await onImport(); })}>Import custom theme…</button>
      </div>

      {editing && onSave ? (
        <form className="theme-editor" onSubmit={(event) => {
          event.preventDefault();
          void run(`save-${editing.id}`, async () => {
            const form = new FormData(event.currentTarget);
            await onSave({ ...editing, name: String(form.get('name') || editing.name), description: String(form.get('description') || editing.description) });
            setEditing(null);
          });
        }}>
          <h4>Edit custom theme</h4>
          <label>Name<input name="name" defaultValue={editing.name} maxLength={80} /></label>
          <label>Description<textarea name="description" defaultValue={editing.description} maxLength={400} /></label>
          <div><button type="button" onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="primary">Save theme</button></div>
        </form>
      ) : null}

      {customById.size === 0 ? <p className="theme-gallery-empty">No custom themes yet. Import a versioned JSON theme package to add one.</p> : null}
    </section>
  );
}
