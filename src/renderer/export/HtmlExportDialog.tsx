import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import type {
  HtmlExportFileResult,
  HtmlExportOptions,
  HtmlExportResult,
  HtmlExportTheme,
} from '../../shared/html-export';
import { defaultHtmlExportOptions } from '../../shared/html-export';
import './html-export.css';

export interface HtmlExportDialogProps {
  open: boolean;
  defaultTitle: string;
  onClose(): void;
  onPreview(options: HtmlExportOptions): Promise<HtmlExportResult>;
  onExport(options: HtmlExportOptions): Promise<HtmlExportFileResult | null>;
}

const themes: Array<{ value: HtmlExportTheme; label: string }> = [
  { value: 'markora-light', label: 'Markora Light' },
  { value: 'markora-dark', label: 'Markora Dark' },
  { value: 'github-light', label: 'GitHub Light' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'print', label: 'Print' },
];

export function HtmlExportDialog({
  open,
  defaultTitle,
  onClose,
  onPreview,
  onExport,
}: HtmlExportDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<HtmlExportOptions>(() => ({
    ...defaultHtmlExportOptions,
    metadata: { title: defaultTitle },
  }));
  const [preview, setPreview] = useState<HtmlExportResult | null>(null);
  const [busy, setBusy] = useState<'preview' | 'export' | null>(null);
  const [error, setError] = useState('');
  const [exportedPath, setExportedPath] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft((current) => ({ ...current, metadata: { ...current.metadata, title: defaultTitle } }));
    setPreview(null);
    setError('');
    setExportedPath('');
  }, [defaultTitle, open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let active = true;
    queueMicrotask(() => {
      if (active) closeButtonRef.current?.focus();
    });
    return () => {
      active = false;
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const update = <Key extends keyof HtmlExportOptions>(key: Key, value: HtmlExportOptions[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setExportedPath('');
  };
  const updateMetadata = (key: 'title' | 'author' | 'description' | 'date' | 'language', value: string) => {
    setDraft((current) => ({ ...current, metadata: { ...current.metadata, [key]: value } }));
    setPreview(null);
    setExportedPath('');
  };
  const previewDocument = async () => {
    setBusy('preview');
    setError('');
    try {
      setPreview(await onPreview(draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'HTML preview failed.');
    } finally {
      setBusy(null);
    }
  };
  const exportDocument = async () => {
    setBusy('export');
    setError('');
    setExportedPath('');
    try {
      const result = await onExport(draft);
      if (result) setExportedPath(result.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'HTML export failed.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="html-export-dialog"
      size="large"
      closeOnBackdrop
      busy={Boolean(busy)}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={descriptionId}
    >
        <header className="html-export-header">
          <div>
            <h2 id={titleId}>Export HTML</h2>
            <p id={descriptionId}>Configure a safe, portable HTML document and inspect it before saving.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close HTML export"
            onClick={onClose}
            disabled={Boolean(busy)}
          >
            ×
          </button>
        </header>
        <div className="html-export-body">
          <form
            className="html-export-options"
            onSubmit={(event) => {
              event.preventDefault();
              void previewDocument();
            }}
          >
            <fieldset>
              <legend>Document</legend>
              <label>
                Title
                <input
                  value={draft.metadata?.title ?? ''}
                  maxLength={500}
                  onChange={(event) => updateMetadata('title', event.target.value)}
                />
              </label>
              <label>
                Author
                <input
                  value={draft.metadata?.author ?? ''}
                  maxLength={500}
                  onChange={(event) => updateMetadata('author', event.target.value)}
                />
              </label>
              <label>
                Date
                <input
                  value={draft.metadata?.date ?? ''}
                  maxLength={100}
                  placeholder="YYYY-MM-DD"
                  onChange={(event) => updateMetadata('date', event.target.value)}
                />
              </label>
              <label>
                Language
                <input
                  value={draft.metadata?.language ?? ''}
                  maxLength={50}
                  placeholder="en"
                  onChange={(event) => updateMetadata('language', event.target.value)}
                />
              </label>
              <label className="html-export-wide">
                Description
                <textarea
                  value={draft.metadata?.description ?? ''}
                  maxLength={2000}
                  rows={2}
                  onChange={(event) => updateMetadata('description', event.target.value)}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>Format and theme</legend>
              <label>
                Output
                <select
                  value={draft.standalone ? 'standalone' : 'fragment'}
                  onChange={(event) => update('standalone', event.target.value === 'standalone')}
                >
                  <option value="standalone">Standalone document</option>
                  <option value="fragment">HTML fragment</option>
                </select>
              </label>
              <label>
                Styling
                <select
                  value={draft.styling}
                  onChange={(event) => update('styling', event.target.value as HtmlExportOptions['styling'])}
                >
                  <option value="styled">Styled</option>
                  <option value="unstyled">Unstyled</option>
                </select>
              </label>
              <label>
                Theme
                <select
                  value={draft.theme}
                  disabled={draft.styling === 'unstyled'}
                  onChange={(event) => update('theme', event.target.value as HtmlExportTheme)}
                >
                  {themes.map((theme) => (
                    <option key={theme.value} value={theme.value}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <fieldset className="html-export-checks">
              <legend>Content</legend>
              <label>
                <input
                  type="checkbox"
                  checked={draft.embedCss}
                  onChange={(event) => update('embedCss', event.target.checked)}
                />{' '}
                Embed CSS
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.embedLocalImages}
                  onChange={(event) => update('embedLocalImages', event.target.checked)}
                />{' '}
                Embed local images
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.includeTableOfContents}
                  onChange={(event) => update('includeTableOfContents', event.target.checked)}
                />{' '}
                Table of contents
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.syntaxHighlighting}
                  onChange={(event) => update('syntaxHighlighting', event.target.checked)}
                />{' '}
                Syntax highlighting
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.renderMath}
                  onChange={(event) => update('renderMath', event.target.checked)}
                />{' '}
                Render KaTeX math
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.renderMermaid}
                  onChange={(event) => update('renderMermaid', event.target.checked)}
                />{' '}
                Render Mermaid diagrams
              </label>
            </fieldset>
            <div className="html-export-actions">
              <button type="submit" disabled={Boolean(busy)}>
                {busy === 'preview' ? 'Generating preview…' : 'Generate preview'}
              </button>
              <button
                type="button"
                className="primary"
                disabled={Boolean(busy)}
                onClick={() => void exportDocument()}
              >
                {busy === 'export' ? 'Exporting…' : 'Export HTML…'}
              </button>
            </div>
          </form>
          <section className="html-export-preview" aria-label="HTML export preview">
            {preview ? (
              <iframe title="HTML export preview" sandbox="allow-scripts" srcDoc={preview.html} />
            ) : (
              <div className="html-export-empty">
                Select “Generate preview” to inspect the exported document.
              </div>
            )}
          </section>
        </div>
        <footer className="html-export-footer" aria-live="polite">
          {error && (
            <p className="html-export-error" role="alert">
              {error}
            </p>
          )}
          {exportedPath && (
            <p>
              Exported to <span title={exportedPath}>{exportedPath}</span>
            </p>
          )}
          {preview && (
            <p>
              {preview.headingCount} headings · {preview.embeddedImageCount} embedded images
              {preview.warnings.length ? ` · ${preview.warnings.length} warnings` : ''}
            </p>
          )}
          {preview?.warnings.length ? (
            <details>
              <summary>Export warnings</summary>
              <ul>
                {preview.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>
                    {warning.message}
                    {warning.source ? ` (${warning.source})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </footer>
    </Dialog>
  );
}
