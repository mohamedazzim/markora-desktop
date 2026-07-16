import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import {
  ASSET_DESTINATION_OPTIONS,
  validateImageWorkflow,
  type AssetDestinationStrategy,
  type ImageAlignment,
  type ImageSourceKind,
  type ImageWorkflowValue,
} from './image-utils';
import './image-workflows.css';

export interface ImageFileSelection {
  /** Opaque path returned by a future typed preload file-picker call. */
  readonly path: string;
  readonly displayName: string;
}

export interface ImageDialogResult extends ImageWorkflowValue {
  readonly operation: 'insert' | 'edit';
  readonly selectedFile?: ImageFileSelection;
}

export type ImageDialogAction =
  | 'remove'
  | 'reveal'
  | 'open'
  | 'copy-path'
  | 'copy-image'
  | 'localize';

export interface ImageDialogProps {
  readonly open: boolean;
  readonly operation?: 'insert' | 'edit';
  readonly initialValue?: Partial<ImageWorkflowValue>;
  readonly documentSaved: boolean;
  readonly workspaceAvailable: boolean;
  /** Integration boundary: the parent may implement this through typed preload IPC. */
  readonly onChooseFile?: () => Promise<ImageFileSelection | null>;
  readonly onSubmit: (result: ImageDialogResult) => void;
  readonly onCancel: () => void;
  readonly actions?: readonly ImageDialogAction[];
  readonly onAction?: (action: ImageDialogAction) => void;
}

function inferSourceKind(value: Partial<ImageWorkflowValue> | undefined): ImageSourceKind {
  if (value?.sourceKind) return value.sourceKind;
  return /^https?:\/\//i.test(value?.src ?? '') ? 'url' : 'file';
}

function optionalDimension(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const dimension = Number(value);
  return Number.isFinite(dimension) ? dimension : Number.NaN;
}

function nameWithoutExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[^.]+$/, '');
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('hidden'));
}

export function ImageDialog({
  open,
  operation = 'insert',
  initialValue,
  documentSaved,
  workspaceAvailable,
  onChooseFile,
  onSubmit,
  onCancel,
  actions = [],
  onAction,
}: ImageDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [sourceKind, setSourceKind] = useState<ImageSourceKind>('file');
  const [src, setSrc] = useState('');
  const [selectedFile, setSelectedFile] = useState<ImageFileSelection | undefined>();
  const [destination, setDestination] = useState<AssetDestinationStrategy>('assets-directory');
  const [alt, setAlt] = useState('');
  const [title, setTitle] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(true);
  const [alignment, setAlignment] = useState<ImageAlignment>('default');
  const [errors, setErrors] = useState<string[]>([]);
  const [pickerError, setPickerError] = useState('');
  const [choosingFile, setChoosingFile] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSourceKind(inferSourceKind(initialValue));
    setSrc(initialValue?.src ?? '');
    setSelectedFile(undefined);
    setDestination(initialValue?.destination ?? 'assets-directory');
    setAlt(initialValue?.alt ?? '');
    setTitle(initialValue?.title ?? '');
    setWidth(initialValue?.width === undefined ? '' : String(initialValue.width));
    setHeight(initialValue?.height === undefined ? '' : String(initialValue.height));
    setPreserveAspectRatio(initialValue?.preserveAspectRatio ?? true);
    setAlignment(initialValue?.alignment ?? 'default');
    setErrors([]);
    setPickerError('');
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => focusableElements(dialogRef.current!)[0]?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  const selectSourceKind = (next: ImageSourceKind) => {
    if (next === sourceKind) return;
    setSourceKind(next);
    setSrc('');
    setSelectedFile(undefined);
    setErrors([]);
    setPickerError('');
  };

  const chooseFile = async () => {
    if (!onChooseFile || choosingFile) return;
    setChoosingFile(true);
    setPickerError('');
    try {
      const selection = await onChooseFile();
      if (!selection) return;
      setSelectedFile(selection);
      setSrc(selection.path);
      if (!alt) setAlt(nameWithoutExtension(selection.displayName));
    } catch (cause) {
      setPickerError(cause instanceof Error ? cause.message : 'The image file could not be selected.');
    } finally {
      setChoosingFile(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value: ImageWorkflowValue = {
      sourceKind,
      src: src.trim(),
      destination,
      alt: alt.trim(),
      title: title.trim() || undefined,
      width: optionalDimension(width),
      height: optionalDimension(height),
      preserveAspectRatio,
      alignment,
    };
    const issues = validateImageWorkflow(value, { documentSaved, workspaceAvailable });
    if (issues.length > 0) {
      setErrors(Array.from(new Set(issues.map((issue) => issue.message))));
      return;
    }
    onSubmit({ ...value, operation, selectedFile });
  };

  const destinationDescription =
    ASSET_DESTINATION_OPTIONS.find((option) => option.value === destination)?.description ?? '';

  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="image-dialog"
      size="large"
      closeOnBackdrop
      busy={choosingFile}
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={`${descriptionId}${errors.length > 0 ? ` ${errorId}` : ''}`}
    >
        <header className="image-dialog-header">
          <div>
            <h2 id={titleId}>{operation === 'edit' ? 'Edit image' : 'Insert image'}</h2>
            <p id={descriptionId}>Choose a source, asset destination, and accessible image presentation.</p>
          </div>
          <button
            type="button"
            className="image-dialog-close"
            onClick={onCancel}
            aria-label="Close image dialog"
          >
            ×
          </button>
        </header>

        <form onSubmit={submit} noValidate>
          {errors.length > 0 && (
            <div id={errorId} className="image-dialog-errors" role="alert" aria-live="assertive">
              <p>Please correct the following:</p>
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <fieldset className="image-dialog-source">
            <legend>Image source</legend>
            <div className="image-dialog-segmented">
              <label>
                <input
                  type="radio"
                  name="image-source"
                  value="file"
                  checked={sourceKind === 'file'}
                  onChange={() => selectSourceKind('file')}
                />
                File
              </label>
              <label>
                <input
                  type="radio"
                  name="image-source"
                  value="url"
                  checked={sourceKind === 'url'}
                  onChange={() => selectSourceKind('url')}
                />
                URL
              </label>
            </div>

            {sourceKind === 'file' ? (
              <div className="image-dialog-file-row">
                <label>
                  Selected image file
                  <input
                    value={selectedFile?.displayName ?? src}
                    readOnly
                    placeholder="No image selected"
                    aria-describedby={pickerError ? `${errorId}-picker` : undefined}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void chooseFile()}
                  disabled={!onChooseFile || choosingFile}
                >
                  {choosingFile ? 'Choosing…' : 'Browse…'}
                </button>
              </div>
            ) : (
              <label>
                Image URL
                <input
                  type="url"
                  value={src}
                  onChange={(event) => setSrc(event.target.value)}
                  placeholder="https://example.com/image.png"
                  autoComplete="url"
                  spellCheck={false}
                />
              </label>
            )}
            {pickerError && (
              <p id={`${errorId}-picker`} className="image-dialog-inline-error" role="status">
                {pickerError}
              </p>
            )}
          </fieldset>

          <label>
            Asset destination
            <select
              value={destination}
              onChange={(event) => setDestination(event.target.value as AssetDestinationStrategy)}
            >
              {ASSET_DESTINATION_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={
                    (option.requiresSavedDocument && !documentSaved) ||
                    (option.requiresWorkspace && !workspaceAvailable)
                  }
                >
                  {option.label}
                </option>
              ))}
            </select>
            <span className="image-dialog-help">{destinationDescription}</span>
          </label>

          <div className="image-dialog-grid">
            <label className="image-dialog-span-two">
              Alt text
              <input
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                placeholder="Describe the image, or leave empty if decorative"
              />
            </label>
            <label className="image-dialog-span-two">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Optional tooltip"
              />
            </label>
            <label>
              Width (px)
              <input
                type="number"
                min="1"
                max="100000"
                value={width}
                onChange={(event) => setWidth(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              Height (px)
              <input
                type="number"
                min="1"
                max="100000"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label>
              Alignment
              <select
                value={alignment}
                onChange={(event) => setAlignment(event.target.value as ImageAlignment)}
              >
                <option value="default">Default</option>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="image-dialog-checkbox">
              <input
                type="checkbox"
                checked={preserveAspectRatio}
                onChange={(event) => setPreserveAspectRatio(event.target.checked)}
              />
              Preserve aspect ratio
            </label>
          </div>

          <footer className="image-dialog-actions">
            {actions.length > 0 && (
              <div className="image-dialog-secondary-actions" aria-label="Image actions">
                {actions.includes('reveal') && <button type="button" onClick={() => onAction?.('reveal')}>Reveal</button>}
                {actions.includes('open') && <button type="button" onClick={() => onAction?.('open')}>Open externally</button>}
                {actions.includes('copy-path') && <button type="button" onClick={() => onAction?.('copy-path')}>Copy path</button>}
                {actions.includes('copy-image') && <button type="button" onClick={() => onAction?.('copy-image')}>Copy image</button>}
                {actions.includes('localize') && <button type="button" onClick={() => onAction?.('localize')}>Save remote locally</button>}
                {actions.includes('remove') && <button type="button" className="danger" onClick={() => onAction?.('remove')}>Remove</button>}
              </div>
            )}
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {operation === 'edit' ? 'Apply changes' : 'Insert image'}
            </button>
          </footer>
        </form>
    </Dialog>
  );
}
