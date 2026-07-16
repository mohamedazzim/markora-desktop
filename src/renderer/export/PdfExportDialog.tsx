import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Dialog } from '../components/Dialog';
import type {
  MarkoraApi,
  PdfExportDocument,
  PdfExportOptions,
  PdfExportProgressRecord,
  PdfExportResult,
  PdfPreviewRecord,
} from '../../shared/contracts';
import { defaultPdfExportOptions } from '../../shared/pdf-options';
import {
  PdfPresetStore,
  type PdfExportPreset,
  type PdfPresetStorage,
} from './pdf-presets';
import './pdf-export.css';

export interface PdfExportApi {
  pickPdfOutput: MarkoraApi['pickPdfOutput'];
  previewPdf: MarkoraApi['previewPdf'];
  exportPdf: MarkoraApi['exportPdf'];
  cancelPdf: MarkoraApi['cancelPdf'];
  onPdfExportProgress: MarkoraApi['onPdfExportProgress'];
}

export interface PdfExportDialogProps {
  readonly open: boolean;
  readonly document: PdfExportDocument;
  readonly initialOptions?: Partial<PdfExportOptions>;
  readonly api?: PdfExportApi;
  readonly presetStorage?: PdfPresetStorage;
  readonly onExported?: (result: PdfExportResult) => void;
  readonly onClose: () => void;
}

const pageSizes: PdfExportOptions['pageSize'][] = [
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'Letter', 'Legal', 'Tabloid', 'Ledger', 'Custom',
];

function mergeOptions(initial?: Partial<PdfExportOptions>): PdfExportOptions {
  return {
    ...defaultPdfExportOptions,
    ...initial,
    margins: { ...defaultPdfExportOptions.margins, ...initial?.margins },
    header: { ...defaultPdfExportOptions.header, ...initial?.header },
    footer: { ...defaultPdfExportOptions.footer, ...initial?.footer },
    pageBreaks: { ...defaultPdfExportOptions.pageBreaks, ...initial?.pageBreaks },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, '') : 'PDF export failed.';
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="pdf-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function PdfExportDialog({
  open,
  document: exportDocument,
  initialOptions,
  api: apiProp,
  presetStorage,
  onExported,
  onClose,
}: PdfExportDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const api = apiProp ?? window.markora;
  const storage = presetStorage ?? window.localStorage;
  const presetStore = useMemo(() => new PdfPresetStore(storage), [storage]);
  const [options, setOptions] = useState<PdfExportOptions>(() => mergeOptions(initialOptions));
  const [presets, setPresets] = useState<PdfExportPreset[]>(() => presetStore.list());
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [preview, setPreview] = useState<PdfPreviewRecord>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [operationId, setOperationId] = useState<string>();
  const [progress, setProgress] = useState<PdfExportProgressRecord>();
  const [result, setResult] = useState<PdfExportResult>();
  const [error, setError] = useState('');

  const running = Boolean(operationId);

  useEffect(() => {
    if (!open) return;
    setOptions(mergeOptions(initialOptions));
    setPresets(presetStore.list());
    setPresetId('');
    setPresetName('');
    setPreview(undefined);
    setProgress(undefined);
    setResult(undefined);
    setError('');
  }, [open, initialOptions, presetStore]);

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
    return api.onPdfExportProgress((next) => {
      if (next.operationId === operationId) setProgress(next);
    });
  }, [api, open, operationId]);

  if (!open) return null;

  const update = <K extends keyof PdfExportOptions>(key: K, value: PdfExportOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
    setPreview(undefined);
    setResult(undefined);
  };

  const updateMargin = (key: keyof PdfExportOptions['margins'], value: number) => {
    update('margins', { ...options.margins, [key]: value });
  };

  const updatePageBreak = <K extends keyof PdfExportOptions['pageBreaks']>(
    key: K,
    value: PdfExportOptions['pageBreaks'][K],
  ) => update('pageBreaks', { ...options.pageBreaks, [key]: value });

  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = presets.find((candidate) => candidate.id === id);
    if (!preset) return;
    setOptions({
      ...preset.options,
      title: options.title,
      author: options.author,
      date: options.date,
    });
    setPreview(undefined);
    setError('');
  };

  const savePreset = () => {
    try {
      const saved = presetStore.save(presetName, options);
      setPresets(presetStore.list());
      setPresetId(saved.id);
      setPresetName('');
      setError('');
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const deletePreset = () => {
    if (!presetStore.remove(presetId)) return;
    setPresets(presetStore.list());
    setPresetId('');
  };

  const generatePreview = async () => {
    setPreviewBusy(true);
    setError('');
    try {
      setPreview(await api.previewPdf({ document: exportDocument, options }));
    } catch (previewError) {
      setError(errorMessage(previewError));
    } finally {
      setPreviewBusy(false);
    }
  };

  const startExport = async () => {
    setError('');
    setResult(undefined);
    try {
      const output = await api.pickPdfOutput(options.title || 'document');
      if (!output) return;
      const id = `pdf-${crypto.randomUUID()}`;
      setOperationId(id);
      setProgress({ operationId: id, stage: 'preparing', message: 'Preparing the print document…' });
      const exported = await api.exportPdf({
        operationId: id,
        outputPath: output.path,
        document: exportDocument,
        options,
      });
      setResult(exported);
      onExported?.(exported);
    } catch (exportError) {
      setError(errorMessage(exportError));
    } finally {
      setOperationId(undefined);
    }
  };

  const cancel = async () => {
    if (!operationId) return;
    await api.cancelPdf(operationId);
  };

  const selectedPreset = presets.find((preset) => preset.id === presetId);

  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="pdf-dialog"
      size="wide"
      closeOnBackdrop={false}
      busy={running}
      initialFocus="[data-autofocus]"
      closeOnEscape={false}
      onEscape={() => {
        if (running) void cancel();
        else onClose();
      }}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={descriptionId}
    >
        <header className="pdf-dialog-header">
          <div>
            <h2 id={titleId}>Export PDF</h2>
            <p id={descriptionId}>Configure Chromium print output and verify it in the preview before saving.</p>
          </div>
          <button type="button" aria-label="Close PDF export" disabled={running} onClick={onClose}>×</button>
        </header>

        <div className="pdf-dialog-body">
          <form className="pdf-options" onSubmit={(event) => event.preventDefault()}>
            <fieldset disabled={running || previewBusy}>
              <legend>Named preset</legend>
              <label>
                <span>Preset</span>
                <select data-autofocus value={presetId} onChange={(event) => applyPreset(event.currentTarget.value)}>
                  <option value="">Custom settings</option>
                  {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
              </label>
              <div className="pdf-inline-fields">
                <label><span>New preset name</span><input value={presetName} maxLength={100} onChange={(event) => setPresetName(event.currentTarget.value)} /></label>
                <button type="button" disabled={!presetName.trim()} onClick={savePreset}>Save preset</button>
                <button type="button" disabled={!selectedPreset || selectedPreset.builtIn} onClick={deletePreset}>Delete</button>
              </div>
            </fieldset>

            <fieldset disabled={running || previewBusy}>
              <legend>Page</legend>
              <div className="pdf-field-grid">
                <label><span>Page size</span><select aria-label="Page size" value={options.pageSize} onChange={(event) => update('pageSize', event.currentTarget.value as PdfExportOptions['pageSize'])}>{pageSizes.map((size) => <option key={size}>{size}</option>)}</select></label>
                <label><span>Orientation</span><select aria-label="Orientation" value={options.orientation} onChange={(event) => update('orientation', event.currentTarget.value as PdfExportOptions['orientation'])}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
                {options.pageSize === 'Custom' && <>
                  <NumberField label="Custom width (mm)" value={options.customPageSize?.widthMm ?? 210} min={25.4} max={5_080} step={0.1} onChange={(widthMm) => update('customPageSize', { widthMm, heightMm: options.customPageSize?.heightMm ?? 297 })} />
                  <NumberField label="Custom height (mm)" value={options.customPageSize?.heightMm ?? 297} min={25.4} max={5_080} step={0.1} onChange={(heightMm) => update('customPageSize', { widthMm: options.customPageSize?.widthMm ?? 210, heightMm })} />
                </>}
              </div>
              <div className="pdf-field-grid pdf-margins" aria-label="Page margins">
                <NumberField label="Top margin (mm)" value={options.margins.top} min={0} max={100} step={0.5} onChange={(value) => updateMargin('top', value)} />
                <NumberField label="Right margin (mm)" value={options.margins.right} min={0} max={100} step={0.5} onChange={(value) => updateMargin('right', value)} />
                <NumberField label="Bottom margin (mm)" value={options.margins.bottom} min={0} max={100} step={0.5} onChange={(value) => updateMargin('bottom', value)} />
                <NumberField label="Left margin (mm)" value={options.margins.left} min={0} max={100} step={0.5} onChange={(value) => updateMargin('left', value)} />
              </div>
              <NumberField label="Scale" value={options.scale} min={0.25} max={2} step={0.05} onChange={(value) => update('scale', value)} />
              <Toggle label="Print background graphics" checked={options.printBackground} onChange={(value) => update('printBackground', value)} />
            </fieldset>

            <fieldset disabled={running || previewBusy}>
              <legend>Document metadata and navigation</legend>
              <label><span>Title</span><input value={options.title} maxLength={500} onChange={(event) => update('title', event.currentTarget.value)} /></label>
              <label><span>Author</span><input value={options.author} maxLength={500} onChange={(event) => update('author', event.currentTarget.value)} /></label>
              <label><span>Date</span><input value={options.date} maxLength={100} onChange={(event) => update('date', event.currentTarget.value)} /></label>
              <Toggle label="Add table of contents" checked={options.tableOfContents} onChange={(value) => update('tableOfContents', value)} />
              <Toggle label="Generate tagged PDF (experimental Chromium support)" checked={options.generateTaggedPdf} onChange={(value) => update('generateTaggedPdf', value)} />
              <Toggle label="Generate heading outline/bookmarks where Chromium supports it" checked={options.generateDocumentOutline} onChange={(value) => update('generateDocumentOutline', value)} />
            </fieldset>

            <fieldset disabled={running || previewBusy}>
              <legend>Header and footer</legend>
              <Toggle label="Header" checked={options.header.enabled} onChange={(enabled) => update('header', { ...options.header, enabled })} />
              <label><span>Header text</span><input disabled={!options.header.enabled} value={options.header.text} onChange={(event) => update('header', { ...options.header, text: event.currentTarget.value })} /></label>
              <Toggle label="Footer" checked={options.footer.enabled} onChange={(enabled) => update('footer', { ...options.footer, enabled })} />
              <label><span>Footer text</span><input disabled={!options.footer.enabled} value={options.footer.text} onChange={(event) => update('footer', { ...options.footer, text: event.currentTarget.value })} /></label>
              <Toggle label="Page numbers" checked={options.pageNumbers} onChange={(value) => update('pageNumbers', value)} />
              <p className="pdf-help">Templates support {'{{title}}'}, {'{{author}}'}, {'{{date}}'}, {'{{page}}'}, and {'{{pages}}'}.</p>
            </fieldset>

            <fieldset disabled={running || previewBusy}>
              <legend>Appearance</legend>
              <label><span>Print theme</span><select aria-label="Print theme" value={options.printTheme} onChange={(event) => update('printTheme', event.currentTarget.value as PdfExportOptions['printTheme'])}><option value="document">Document theme</option><option value="light">Light</option><option value="dark">Dark</option><option value="sepia">Sepia</option></select></label>
              <Toggle label="Force light theme" checked={options.lightThemeOverride} onChange={(value) => update('lightThemeOverride', value)} />
              <Toggle label="Allow remote HTTP(S) images during export" checked={options.allowRemoteImages} onChange={(value) => update('allowRemoteImages', value)} />
              <label><span>Print CSS</span><textarea aria-label="Print CSS" rows={6} value={options.printCss} onChange={(event) => update('printCss', event.currentTarget.value)} placeholder=".markora-pdf-document h1 { color: #234; }" /></label>
            </fieldset>

            <fieldset disabled={running || previewBusy}>
              <legend>Page breaks</legend>
              <div className="pdf-heading-breaks" aria-label="Start headings on a new page">
                {[1, 2, 3, 4, 5, 6].map((depth) => <Toggle key={depth} label={`H${depth} on new page`} checked={options.pageBreaks.beforeHeadings.includes(depth as 1 | 2 | 3 | 4 | 5 | 6)} onChange={(checked) => updatePageBreak('beforeHeadings', checked ? [...options.pageBreaks.beforeHeadings, depth as 1 | 2 | 3 | 4 | 5 | 6] : options.pageBreaks.beforeHeadings.filter((value) => value !== depth))} />)}
              </div>
              <Toggle label="Avoid page breaks inside tables" checked={options.pageBreaks.avoidInsideTables} onChange={(value) => updatePageBreak('avoidInsideTables', value)} />
              <Toggle label="Avoid page breaks inside code blocks" checked={options.pageBreaks.avoidInsideCodeBlocks} onChange={(value) => updatePageBreak('avoidInsideCodeBlocks', value)} />
              <Toggle label="Avoid page breaks inside blockquotes" checked={options.pageBreaks.avoidInsideBlockquotes} onChange={(value) => updatePageBreak('avoidInsideBlockquotes', value)} />
              <Toggle label="Keep headings with following content" checked={options.pageBreaks.keepHeadingWithNext} onChange={(value) => updatePageBreak('keepHeadingWithNext', value)} />
            </fieldset>
          </form>

          <section className="pdf-preview" aria-label="PDF export preview">
            <div className="pdf-preview-toolbar">
              <h3>Preview</h3>
              {preview && <span>{preview.pageWidthMm.toFixed(1)} × {preview.pageHeightMm.toFixed(1)} mm</span>}
            </div>
            {preview ? (
              <iframe
                title="PDF preview"
                sandbox=""
                srcDoc={preview.html}
                style={{ aspectRatio: `${preview.pageWidthMm} / ${preview.pageHeightMm}` }}
              />
            ) : (
              <div className="pdf-preview-empty">Choose Preview to render the current settings. No file is written.</div>
            )}
          </section>
        </div>

        {error && <div className="pdf-error" role="alert">{error}</div>}
        <div className="pdf-status" aria-live="polite">
          {progress && <span>{progress.message}</span>}
          {result && <span>Saved {result.pageCount ?? 'an unknown number of'} pages ({result.byteLength.toLocaleString()} bytes) to {result.outputPath}</span>}
        </div>

        <footer className="pdf-dialog-footer">
          <button type="button" disabled={running || previewBusy} onClick={() => void generatePreview()}>{previewBusy ? 'Rendering preview…' : 'Preview'}</button>
          {running ? <button type="button" onClick={() => void cancel()}>Cancel export</button> : <button type="button" onClick={() => void startExport()}>Export PDF…</button>}
          <button type="button" disabled={running} onClick={onClose}>Close</button>
        </footer>
    </Dialog>
  );
}
