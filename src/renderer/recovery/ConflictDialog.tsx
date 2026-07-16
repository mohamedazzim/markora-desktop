import { useEffect, useId, useRef, useState } from 'react';
import type { ConflictResolution, EditorDiskConflict } from './recovery-controller';
import { Dialog } from '../components/Dialog';
import './recovery.css';

export interface ConflictDialogProps {
  open: boolean;
  conflict: EditorDiskConflict | null;
  onResolve(resolution: ConflictResolution): Promise<void> | void;
  onClose(): void;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  );
}

function conflictDescription(conflict: EditorDiskConflict): string {
  switch (conflict.result.conflict.kind) {
    case 'modified':
      return 'Another application saved a newer version while this document had local edits.';
    case 'renamed':
      return `The file was renamed to ${conflict.result.conflict.renamedPath ?? 'a new location'}.`;
    case 'deleted':
      return 'The file was deleted or moved outside its original folder.';
    case 'destination-exists':
      return 'A file already exists at the selected destination.';
  }
}

type DiffLine = { type: 'added' | 'removed' | 'unchanged'; value: string; line: number };
type DiffResult = { lines: DiffLine[]; truncated: boolean };

/** Bounded line diff that remains responsive for large conflict documents. */
function computeLineDiff(original: string, modified: string): DiffResult {
  const originalLines = original.split(/\r?\n/);
  const modifiedLines = modified.split(/\r?\n/);
  const maxLines = 4_000;
  if (originalLines.length + modifiedLines.length > maxLines) {
    return {
      truncated: true,
      lines: [
        { type: 'removed', value: `Disk version (${originalLines.length.toLocaleString()} lines)`, line: 0 },
        { type: 'added', value: `Editor version (${modifiedLines.length.toLocaleString()} lines)`, line: 0 },
      ],
    };
  }
  const result: DiffLine[] = [];
  let originalIndex = 0;
  let modifiedIndex = 0;
  let outputLine = 1;
  const lookAhead = 32;
  while (originalIndex < originalLines.length || modifiedIndex < modifiedLines.length) {
    const originalLine = originalLines[originalIndex];
    const modifiedLine = modifiedLines[modifiedIndex];
    if (originalLine !== undefined && originalLine === modifiedLine) {
      result.push({ type: 'unchanged', value: originalLine, line: outputLine++ });
      originalIndex++;
      modifiedIndex++;
      continue;
    }
    if (originalLine === undefined) {
      result.push({ type: 'added', value: modifiedLine ?? '', line: outputLine++ });
      modifiedIndex++;
      continue;
    }
    if (modifiedLine === undefined) {
      result.push({ type: 'removed', value: originalLine, line: outputLine++ });
      originalIndex++;
      continue;
    }
    let nextOriginal = -1;
    let nextModified = -1;
    for (let offset = 1; offset <= lookAhead; offset++) {
      if (nextOriginal < 0 && modifiedLines[modifiedIndex + offset] === originalLine) nextOriginal = offset;
      if (nextModified < 0 && originalLines[originalIndex + offset] === modifiedLine) nextModified = offset;
      if (nextOriginal >= 0 || nextModified >= 0) break;
    }
    if (nextOriginal >= 0 && (nextModified < 0 || nextOriginal <= nextModified)) {
      for (let offset = 0; offset < nextOriginal; offset++) {
        result.push({ type: 'added', value: modifiedLines[modifiedIndex++] ?? '', line: outputLine++ });
      }
    } else {
      result.push({ type: 'removed', value: originalLines[originalIndex++] ?? '', line: outputLine++ });
    }
  }
  return { lines: result, truncated: false };
}

function sideBySideRows(lines: DiffLine[]): Array<{ left?: DiffLine; right?: DiffLine; line: number }> {
  const rows: Array<{ left?: DiffLine; right?: DiffLine; line: number }> = [];
  for (let index = 0; index < lines.length; index++) {
    const current = lines[index];
    const next = lines[index + 1];
    if (current.type === 'removed' && next?.type === 'added') {
      rows.push({ left: current, right: next, line: current.line });
      index++;
    } else if (current.type === 'removed') rows.push({ left: current, line: current.line });
    else if (current.type === 'added') rows.push({ right: current, line: current.line });
    else rows.push({ left: current, right: current, line: current.line });
  }
  return rows;
}

function formatTimestamp(value: number | undefined | null): string {
  if (!value) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

export function ConflictDialog({ open, conflict, onResolve, onClose }: ConflictDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const comparisonId = useId();
  const overwriteTitleId = useId();
  const overwriteDescriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const overwriteTriggerRef = useRef<HTMLButtonElement>(null);
  const overwriteDialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [compare, setCompare] = useState(false);
  const [diffMode, setDiffMode] = useState<'unified' | 'side-by-side'>('unified');
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [busy, setBusy] = useState<ConflictResolution | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    setCompare(false);
    setConfirmOverwrite(false);
    setBusy(null);
    setError('');
    return () => {
      const previous = previousFocus.current;
      if (previous?.isConnected) previous.focus();
      previousFocus.current = null;
    };
  }, [open, conflict]);

  useEffect(() => {
    if (!confirmOverwrite) return;
    const frame = window.requestAnimationFrame(() => {
      overwriteDialogRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.setTimeout(() => {
        if (overwriteTriggerRef.current?.isConnected) overwriteTriggerRef.current.focus();
      }, 0);
    };
  }, [confirmOverwrite]);

  if (!open || !conflict) return null;
  const diskContent = conflict.result.conflict.disk?.content;
  const canReload = typeof diskContent === 'string';
  const diff = computeLineDiff(diskContent ?? '', conflict.document.content);
  const rows = sideBySideRows(diff.lines);
  const diskTimestamp =
    conflict.result.conflict.actual?.modifiedAt ?? conflict.result.conflict.disk?.modifiedAt;

  const resolve = async (resolution: ConflictResolution) => {
    setBusy(resolution);
    setError('');
    try {
      await onResolve(resolution);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The conflict action failed.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="recovery-dialog conflict-dialog"
      size="large"
      closeOnBackdrop={false}
      closeOnEscape={!confirmOverwrite}
      busy={Boolean(busy)}
      onClose={() => (confirmOverwrite ? setConfirmOverwrite(false) : onClose())}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocus="[data-conflict-initial-focus]"
    >
      <header>
        <div>
          <h2 id={titleId}>Resolve disk conflict</h2>
          <p id={descriptionId}>{conflictDescription(conflict)}</p>
        </div>
        <button
          type="button"
          data-conflict-initial-focus
          onClick={onClose}
          disabled={Boolean(busy)}
          aria-label="Close conflict dialog"
        >
          Close
        </button>
      </header>

      <dl className="conflict-metadata">
        <div>
          <dt>Editor document</dt>
          <dd>{conflict.document.name}</dd>
        </div>
        <div>
          <dt>Original path</dt>
          <dd>{conflict.result.conflict.path}</dd>
        </div>
        <div>
          <dt>Last known version</dt>
          <dd>
            <time
              dateTime={
                conflict.result.conflict.expected?.modifiedAt
                  ? new Date(conflict.result.conflict.expected.modifiedAt).toISOString()
                  : undefined
              }
            >
              {formatTimestamp(conflict.result.conflict.expected?.modifiedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Disk version</dt>
          <dd>
            <time dateTime={diskTimestamp ? new Date(diskTimestamp).toISOString() : undefined}>
              {formatTimestamp(diskTimestamp)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Detected</dt>
          <dd>
            <time dateTime={conflict.detectedAt ? new Date(conflict.detectedAt).toISOString() : undefined}>
              {formatTimestamp(conflict.detectedAt)}
            </time>
          </dd>
        </div>
        {conflict.result.conflict.renamedPath ? (
          <div>
            <dt>Detected path</dt>
            <dd>{conflict.result.conflict.renamedPath}</dd>
          </div>
        ) : null}
      </dl>

      {error ? (
        <p role="alert" className="recovery-error">
          {error}
        </p>
      ) : null}
      <div className="conflict-actions">
        <button
          title="Reload from Disk"
          type="button"
          disabled={!canReload || Boolean(busy)}
          onClick={() => void resolve('reload')}
        >
          {busy === 'reload' ? 'Reloading…' : 'Reload from disk'}
        </button>
        <button
          title="Keep Editor Version"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void resolve('keep')}
        >
          {busy === 'keep' ? 'Protecting…' : 'Keep editor version'}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          aria-expanded={compare}
          aria-controls={comparisonId}
          title="Compare Versions"
          onClick={() => setCompare((value) => !value)}
        >
          {compare ? 'Hide comparison' : 'Compare'}
        </button>
        <button
          title="Save as Copy"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void resolve('save-copy')}
        >
          {busy === 'save-copy' ? 'Saving…' : 'Save a copy'}
        </button>
        {!confirmOverwrite ? (
          <button
            ref={overwriteTriggerRef}
            className="danger"
            type="button"
            aria-label="Overwrite disk version…"
            title="Replace Disk File"
            disabled={Boolean(busy)}
            onClick={() => setConfirmOverwrite(true)}
          >
            Replace disk file…
          </button>
        ) : (
          <div
            ref={overwriteDialogRef}
            className="overwrite-confirmation"
            role="alertdialog"
            aria-labelledby={overwriteTitleId}
            aria-describedby={overwriteDescriptionId}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setConfirmOverwrite(false);
                return;
              }
              if (event.key !== 'Tab' || !overwriteDialogRef.current) return;
              const controls = focusableElements(overwriteDialogRef.current);
              const first = controls[0];
              const last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <strong id={overwriteTitleId}>Confirm overwrite</strong>
            <span id={overwriteDescriptionId}>A timestamped backup will be retained before replacement.</span>
            <button
              className="danger"
              type="button"
              data-overwrite-initial-focus
              aria-label="Confirm overwrite"
              disabled={Boolean(busy)}
              onClick={() => void resolve('overwrite')}
            >
              {busy === 'overwrite' ? 'Replacing…' : 'Replace disk file'}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmOverwrite(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {compare ? (
        <section id={comparisonId} className="conflict-comparison" aria-label="Editor and disk comparison">
          <div className="conflict-comparison-header">
            <h3>Version comparison</h3>
            <div className="diff-mode-toggle">
              <button
                type="button"
                className={diffMode === 'unified' ? 'active' : ''}
                onClick={() => setDiffMode('unified')}
              >
                Unified Diff
              </button>
              <button
                type="button"
                className={diffMode === 'side-by-side' ? 'active' : ''}
                onClick={() => setDiffMode('side-by-side')}
              >
                Side-by-Side
              </button>
            </div>
          </div>
          {diffMode === 'unified' ? (
            <pre className="diff-view unified" tabIndex={0}>
              {diff.lines.map((line, idx) => (
                <div key={idx} className={`diff-line ${line.type}`}>
                  <span className="diff-marker">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="diff-code">{line.value}</span>
                </div>
              ))}
              {diff.truncated ? (
                <p className="diff-truncated">
                  The versions are large; showing a summary only. Open each version in Source Mode for a
                  complete comparison.
                </p>
              ) : null}
            </pre>
          ) : (
            <div className="side-by-side-comparison">
              <article className="side-by-side-pane">
                <h4>Disk version</h4>
                <pre tabIndex={0} aria-label="Disk version comparison">
                  {rows.map((row, index) => (
                    <div key={`left-${index}`}>
                      <span className="diff-line-number">{row.left?.line ?? ''}</span> {row.left?.value ?? ''}
                    </div>
                  ))}
                </pre>
              </article>
              <article className="side-by-side-pane">
                <h4>Editor version</h4>
                <pre tabIndex={0} aria-label="Editor version comparison">
                  {rows.map((row, index) => (
                    <div key={`right-${index}`}>
                      <span className="diff-line-number">{row.right?.line ?? ''}</span>{' '}
                      {row.right?.value ?? ''}
                    </div>
                  ))}
                </pre>
              </article>
            </div>
          )}
        </section>
      ) : null}
      <p className="recovery-live" role="status" aria-live="polite">
        {busy ? `${busy} in progress` : ''}
      </p>
    </Dialog>
  );
}
