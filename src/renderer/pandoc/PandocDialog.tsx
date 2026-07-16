import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import './pandoc-ui.css';

export type PandocAvailability = 'checking' | 'available' | 'missing' | 'invalid' | 'error';
export type PandocOperation = 'export' | 'import';
export type PandocExportFormat = 'docx' | 'odt' | 'rtf' | 'epub' | 'latex' | 'mediawiki' | 'plain';
export type PandocImportFormat = 'docx' | 'odt' | 'rtf' | 'html' | 'latex';

export interface PandocStatus {
  readonly availability: PandocAvailability;
  readonly executablePath?: string;
  readonly version?: string;
  readonly detection?: 'path' | 'common-directory' | 'manual' | 'none';
  readonly message?: string;
}

export interface PandocPathSelection {
  readonly path: string;
  readonly displayName: string;
}

export interface PandocPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly operation: 'export';
  readonly format: PandocExportFormat;
}

export interface PandocDiagnostic {
  readonly message: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
}

export type PandocImportPreviewResult =
  | {
      readonly ok: true;
      readonly markdown: string;
      readonly warnings?: readonly string[];
      readonly stdout?: string;
      readonly stderr?: string;
    }
  | { readonly ok: false; readonly error: PandocDiagnostic };

export interface PandocExportRequest {
  readonly operation: 'export';
  readonly executablePath: string;
  readonly format: PandocExportFormat;
  readonly outputPath: string;
  readonly presetId?: string;
}

export interface PandocImportRequest {
  readonly operation: 'import';
  readonly executablePath: string;
  readonly format: PandocImportFormat;
  readonly inputPath: string;
}

export type PandocConversionRequest = PandocExportRequest | PandocImportRequest;

export type PandocConversionState =
  | { readonly state: 'idle' }
  | {
      readonly state: 'running';
      readonly phase: 'preparing' | 'converting' | 'finishing';
      readonly message: string;
      readonly percent?: number;
      readonly cancellable: boolean;
    }
  | {
      readonly state: 'succeeded';
      readonly message: string;
      readonly outputPath?: string;
      readonly stdout?: string;
      readonly stderr?: string;
    }
  | { readonly state: 'failed'; readonly error: PandocDiagnostic }
  | { readonly state: 'cancelled'; readonly message?: string };

export interface PandocDialogProps {
  readonly open: boolean;
  readonly status: PandocStatus;
  readonly conversion: PandocConversionState;
  readonly presets?: readonly PandocPreset[];
  readonly initialOperation?: PandocOperation;
  /** Implement these callbacks through typed preload IPC in the parent. */
  readonly onChooseExecutable: () => Promise<PandocStatus | null>;
  readonly onExecutableSelected?: (status: PandocStatus) => void;
  readonly onChooseInput: (format: PandocImportFormat) => Promise<PandocPathSelection | null>;
  readonly onChooseOutput: (format: PandocExportFormat) => Promise<PandocPathSelection | null>;
  readonly onRequestImportPreview: (request: PandocImportRequest) => Promise<PandocImportPreviewResult>;
  readonly onConvert: (request: PandocConversionRequest) => void;
  readonly onCancelConversion: () => void;
  readonly onClose: () => void;
}

export const PANDOC_EXPORT_FORMATS: ReadonlyArray<{
  value: PandocExportFormat;
  label: string;
}> = [
  { value: 'docx', label: 'Microsoft Word (.docx)' },
  { value: 'odt', label: 'OpenDocument Text (.odt)' },
  { value: 'rtf', label: 'Rich Text Format (.rtf)' },
  { value: 'epub', label: 'EPUB ebook (.epub)' },
  { value: 'latex', label: 'LaTeX (.tex)' },
  { value: 'mediawiki', label: 'MediaWiki markup (.mediawiki)' },
  { value: 'plain', label: 'Plain text (.txt)' },
];

export const PANDOC_IMPORT_FORMATS: ReadonlyArray<{
  value: PandocImportFormat;
  label: string;
}> = [
  { value: 'docx', label: 'Microsoft Word (.docx)' },
  { value: 'odt', label: 'OpenDocument Text (.odt)' },
  { value: 'rtf', label: 'Rich Text Format (.rtf)' },
  { value: 'html', label: 'HTML (.html, .htm)' },
  { value: 'latex', label: 'LaTeX (.tex)' },
];

export const DEFAULT_PANDOC_PRESETS: readonly PandocPreset[] = [
  {
    id: 'standard-docx',
    label: 'Standard Word document',
    description: 'A general-purpose editable Word document.',
    operation: 'export',
    format: 'docx',
  },
  {
    id: 'publication-odt',
    label: 'OpenDocument publication',
    description: 'An editable, vendor-neutral OpenDocument file.',
    operation: 'export',
    format: 'odt',
  },
  {
    id: 'ebook-epub',
    label: 'EPUB ebook',
    description: 'A reflowable ebook for compatible readers.',
    operation: 'export',
    format: 'epub',
  },
];

function statusLabel(status: PandocStatus): string {
  switch (status.availability) {
    case 'checking':
      return 'Checking for Pandoc…';
    case 'available':
      return status.version ? `Pandoc ${status.version} is available` : 'Pandoc is available';
    case 'missing':
      return 'Pandoc was not found';
    case 'invalid':
      return 'The selected Pandoc executable is invalid';
    case 'error':
      return 'Pandoc detection failed';
  }
}

function DiagnosticDetails({ diagnostic }: { readonly diagnostic: PandocDiagnostic }) {
  return (
    <section className="pandoc-diagnostic" aria-label="Pandoc error details">
      <p className="pandoc-diagnostic-message">{diagnostic.message}</p>
      <dl>
        {diagnostic.exitCode !== undefined && (
          <>
            <dt>Exit code</dt>
            <dd>{diagnostic.exitCode === null ? 'Unavailable' : diagnostic.exitCode}</dd>
          </>
        )}
        {diagnostic.timedOut && (
          <>
            <dt>Timeout</dt>
            <dd>The conversion exceeded its configured time limit.</dd>
          </>
        )}
      </dl>
      {diagnostic.stderr !== undefined && (
        <details open>
          <summary>Standard error</summary>
          <pre>{diagnostic.stderr || '(empty)'}</pre>
        </details>
      )}
      {diagnostic.stdout !== undefined && (
        <details>
          <summary>Standard output</summary>
          <pre>{diagnostic.stdout || '(empty)'}</pre>
        </details>
      )}
    </section>
  );
}

export function PandocDialog({
  open,
  status,
  conversion,
  presets = DEFAULT_PANDOC_PRESETS,
  initialOperation = 'export',
  onChooseExecutable,
  onExecutableSelected,
  onChooseInput,
  onChooseOutput,
  onRequestImportPreview,
  onConvert,
  onCancelConversion,
  onClose,
}: PandocDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const validationId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const [effectiveStatus, setEffectiveStatus] = useState(status);
  const [operation, setOperation] = useState<PandocOperation>(initialOperation);
  const [exportFormat, setExportFormat] = useState<PandocExportFormat>('docx');
  const [importFormat, setImportFormat] = useState<PandocImportFormat>('docx');
  const [presetId, setPresetId] = useState('');
  const [input, setInput] = useState<PandocPathSelection | null>(null);
  const [output, setOutput] = useState<PandocPathSelection | null>(null);
  const [preview, setPreview] = useState<PandocImportPreviewResult | null>(null);
  const [busyAction, setBusyAction] = useState<'executable' | 'input' | 'output' | 'preview' | null>(null);
  const [interfaceError, setInterfaceError] = useState('');
  const [validationError, setValidationError] = useState('');

  const running = conversion.state === 'running';

  useEffect(() => {
    if (!open) return;
    setEffectiveStatus(status);
  }, [open, status]);

  useEffect(() => {
    if (!open) return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let active = true;
    queueMicrotask(() => {
      if (active) dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    });
    return () => {
      active = false;
      priorFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setOperation(initialOperation);
    setExportFormat('docx');
    setImportFormat('docx');
    setPresetId('');
    setInput(null);
    setOutput(null);
    setPreview(null);
    setBusyAction(null);
    setInterfaceError('');
    setValidationError('');
  }, [open, initialOperation]);

  if (!open) return null;

  const runPicker = async <T,>(kind: 'executable' | 'input' | 'output', action: () => Promise<T>) => {
    setBusyAction(kind);
    setInterfaceError('');
    try {
      return await action();
    } catch (cause) {
      setInterfaceError(cause instanceof Error ? cause.message : 'The requested selection failed.');
      return undefined;
    } finally {
      setBusyAction(null);
    }
  };

  const chooseExecutable = async () => {
    const selected = await runPicker('executable', onChooseExecutable);
    if (!selected) return;
    setEffectiveStatus(selected);
    onExecutableSelected?.(selected);
  };

  const chooseInput = async () => {
    const selected = await runPicker('input', () => onChooseInput(importFormat));
    if (selected) {
      setInput(selected);
      setPreview(null);
    }
  };

  const chooseOutput = async () => {
    const selected = await runPicker('output', () => onChooseOutput(exportFormat));
    if (selected) setOutput(selected);
  };

  const importRequest = (): PandocImportRequest | null => {
    if (effectiveStatus.availability !== 'available' || !effectiveStatus.executablePath || !input) {
      return null;
    }
    return {
      operation: 'import',
      executablePath: effectiveStatus.executablePath,
      format: importFormat,
      inputPath: input.path,
    };
  };

  const requestPreview = async () => {
    const request = importRequest();
    if (!request) {
      setValidationError('Choose a valid Pandoc executable and input file before previewing.');
      return;
    }
    setBusyAction('preview');
    setInterfaceError('');
    setValidationError('');
    try {
      setPreview(await onRequestImportPreview(request));
    } catch (cause) {
      setPreview({
        ok: false,
        error: {
          message: cause instanceof Error ? cause.message : 'Pandoc could not create an import preview.',
        },
      });
    } finally {
      setBusyAction(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');
    if (effectiveStatus.availability !== 'available' || !effectiveStatus.executablePath) {
      setValidationError('Select a valid Pandoc executable before converting.');
      return;
    }
    if (operation === 'export') {
      if (!output) {
        setValidationError('Choose an output file before exporting.');
        return;
      }
      onConvert({
        operation: 'export',
        executablePath: effectiveStatus.executablePath,
        format: exportFormat,
        outputPath: output.path,
        presetId: presetId || undefined,
      });
      return;
    }
    const request = importRequest();
    if (!request) {
      setValidationError('Choose an input file before importing.');
      return;
    }
    onConvert(request);
  };

  const changeOperation = (next: PandocOperation) => {
    setOperation(next);
    setValidationError('');
    setInterfaceError('');
  };

  const selectPreset = (id: string) => {
    setPresetId(id);
    const selected = presets.find((preset) => preset.id === id);
    if (selected) setExportFormat(selected.format);
  };

  const statusText = statusLabel(effectiveStatus);
  const selectedPreset = presets.find((preset) => preset.id === presetId);
  const controlsDisabled = running || busyAction !== null;

  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="pandoc-dialog"
      size="large"
      closeOnBackdrop
      busy={running}
      initialFocus="[data-autofocus]"
      closeOnEscape={false}
      onEscape={() => {
        if (running && conversion.cancellable) onCancelConversion();
        else if (!running) onClose();
      }}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={`${descriptionId}${validationError ? ` ${validationId}` : ''}`}
    >
        <header className="pandoc-dialog-header">
          <div>
            <h2 id={titleId}>Import or export with Pandoc</h2>
            <p id={descriptionId}>
              Pandoc runs locally. Markora does not send document text to an online service.
            </p>
          </div>
          <button type="button" aria-label="Close Pandoc dialog" onClick={onClose} disabled={running}>
            ×
          </button>
        </header>

        <form onSubmit={submit}>
          <section className={`pandoc-status ${effectiveStatus.availability}`} aria-live="polite">
            <div>
              <strong>{statusText}</strong>
              {effectiveStatus.message && <span>{effectiveStatus.message}</span>}
              {effectiveStatus.executablePath && (
                <code title={effectiveStatus.executablePath}>{effectiveStatus.executablePath}</code>
              )}
            </div>
            <button
              type="button"
              onClick={() => void chooseExecutable()}
              disabled={controlsDisabled}
              data-autofocus
            >
              {busyAction === 'executable' ? 'Validating…' : 'Select executable…'}
            </button>
          </section>

          {interfaceError && (
            <p className="pandoc-interface-error" role="alert">
              {interfaceError}
            </p>
          )}
          {validationError && (
            <p id={validationId} className="pandoc-interface-error" role="alert">
              {validationError}
            </p>
          )}

          <fieldset className="pandoc-operation" disabled={controlsDisabled}>
            <legend>Conversion direction</legend>
            <label>
              <input
                type="radio"
                name="pandoc-operation"
                value="export"
                checked={operation === 'export'}
                onChange={() => changeOperation('export')}
              />
              Export Markdown
            </label>
            <label>
              <input
                type="radio"
                name="pandoc-operation"
                value="import"
                checked={operation === 'import'}
                onChange={() => changeOperation('import')}
              />
              Import document
            </label>
          </fieldset>

          {operation === 'export' ? (
            <section className="pandoc-fields" aria-label="Pandoc export options">
              <label>
                Export preset
                <select
                  aria-label="Export preset"
                  value={presetId}
                  onChange={(event) => selectPreset(event.target.value)}
                  disabled={controlsDisabled}
                >
                  <option value="">Custom settings</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <span>{selectedPreset?.description ?? 'Choose a format and output location.'}</span>
              </label>
              <label>
                Export format
                <select
                  value={exportFormat}
                  onChange={(event) => {
                    setExportFormat(event.target.value as PandocExportFormat);
                    setPresetId('');
                    setOutput(null);
                  }}
                  disabled={controlsDisabled}
                >
                  {PANDOC_EXPORT_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pandoc-path-row">
                <label>
                  Output file
                  <input value={output?.displayName ?? ''} readOnly placeholder="No output file selected" />
                </label>
                <button type="button" onClick={() => void chooseOutput()} disabled={controlsDisabled}>
                  {busyAction === 'output' ? 'Choosing…' : 'Browse…'}
                </button>
              </div>
            </section>
          ) : (
            <section className="pandoc-fields" aria-label="Pandoc import options">
              <label>
                Import format
                <select
                  value={importFormat}
                  onChange={(event) => {
                    setImportFormat(event.target.value as PandocImportFormat);
                    setInput(null);
                    setPreview(null);
                  }}
                  disabled={controlsDisabled}
                >
                  {PANDOC_IMPORT_FORMATS.map((format) => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pandoc-path-row">
                <label>
                  Input file
                  <input value={input?.displayName ?? ''} readOnly placeholder="No input file selected" />
                </label>
                <button type="button" onClick={() => void chooseInput()} disabled={controlsDisabled}>
                  {busyAction === 'input' ? 'Choosing…' : 'Browse…'}
                </button>
              </div>
              <button
                type="button"
                className="pandoc-preview-button"
                onClick={() => void requestPreview()}
                disabled={controlsDisabled || !input || effectiveStatus.availability !== 'available'}
              >
                {busyAction === 'preview' ? 'Creating preview…' : 'Preview import'}
              </button>
              {preview?.ok && (
                <section className="pandoc-preview" aria-label="Import preview">
                  <div>
                    <h3>Markdown preview</h3>
                    {preview.warnings && preview.warnings.length > 0 && (
                      <ul aria-label="Import warnings">
                        {preview.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <textarea readOnly value={preview.markdown} aria-label="Imported Markdown preview" />
                  {(preview.stdout !== undefined || preview.stderr !== undefined) && (
                    <details>
                      <summary>Preview conversion output</summary>
                      {preview.stderr !== undefined && <pre>{preview.stderr || '(no standard error)'}</pre>}
                      {preview.stdout !== undefined && <pre>{preview.stdout || '(no standard output)'}</pre>}
                    </details>
                  )}
                </section>
              )}
              {preview && !preview.ok && <DiagnosticDetails diagnostic={preview.error} />}
            </section>
          )}

          {conversion.state === 'running' && (
            <section className="pandoc-progress" aria-live="polite" aria-busy="true">
              <div>
                <strong>{conversion.message}</strong>
                <span>{conversion.phase}</span>
              </div>
              <progress aria-label="Pandoc conversion progress" value={conversion.percent} max={100} />
              {conversion.cancellable && (
                <button type="button" onClick={onCancelConversion}>
                  Cancel conversion
                </button>
              )}
            </section>
          )}
          {conversion.state === 'succeeded' && (
            <section className="pandoc-result success" role="status">
              <strong>{conversion.message}</strong>
              {conversion.outputPath && <code>{conversion.outputPath}</code>}
              {(conversion.stdout !== undefined || conversion.stderr !== undefined) && (
                <details>
                  <summary>Conversion output</summary>
                  {conversion.stderr !== undefined && <pre>{conversion.stderr || '(no standard error)'}</pre>}
                  {conversion.stdout !== undefined && (
                    <pre>{conversion.stdout || '(no standard output)'}</pre>
                  )}
                </details>
              )}
            </section>
          )}
          {conversion.state === 'failed' && <DiagnosticDetails diagnostic={conversion.error} />}
          {conversion.state === 'cancelled' && (
            <p className="pandoc-result cancelled" role="status">
              {conversion.message ?? 'Conversion cancelled.'}
            </p>
          )}

          <footer className="pandoc-dialog-actions">
            <button type="button" onClick={onClose} disabled={running}>
              Close
            </button>
            <button
              type="submit"
              className="primary"
              disabled={
                controlsDisabled ||
                effectiveStatus.availability !== 'available' ||
                !effectiveStatus.executablePath
              }
            >
              {operation === 'export' ? 'Export' : 'Import'}
            </button>
          </footer>
        </form>
    </Dialog>
  );
}
