import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RestorePlanItem } from './recovery-controller';
import { Dialog } from '../components/Dialog';
import './recovery.css';

export interface RecoveryCenterDialogProps {
  open: boolean;
  items: readonly RestorePlanItem[];
  onRestore(items: readonly RestorePlanItem[]): Promise<void> | void;
  onDiscard(items: readonly RestorePlanItem[]): Promise<void> | void;
  onClose(): void;
}

export function RecoveryCenterDialog({
  open,
  items,
  onRestore,
  onDiscard,
  onClose,
}: RecoveryCenterDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<'restore' | 'discard' | null>(null);
  const [error, setError] = useState('');
  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    setSelected(new Set(items.map((item) => item.id)));
    setBusy(null);
    setError('');
    let active = true;
    queueMicrotask(() => {
      if (active) closeRef.current?.focus();
    });
    return () => {
      active = false;
      const previous = previousFocus.current;
      if (previous?.isConnected) previous.focus();
      previousFocus.current = null;
    };
  }, [items, open]);

  if (!open) return null;
  const perform = async (action: 'restore' | 'discard') => {
    if (!selectedItems.length) return;
    setBusy(action);
    setError('');
    try {
      await (action === 'restore' ? onRestore(selectedItems) : onDiscard(selectedItems));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${action} the selected documents.`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open={open}
      contentRef={dialogRef}
      className="recovery-dialog recovery-center"
      size="large"
      closeOnBackdrop={false}
      busy={Boolean(busy)}
      onClose={onClose}
      labelledBy={titleId}
      describedBy={descriptionId}
    >
        <header>
          <div>
            <h2 id={titleId}>Restore previous session</h2>
            <p id={descriptionId}>
              Choose the documents Markora should restore. Snapshot text remains local on this computer.
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={Boolean(busy)}>
            Not now
          </button>
        </header>
        {error ? (
          <p className="recovery-error" role="alert">
            {error}
          </p>
        ) : null}
        {items.length ? (
          <fieldset>
            <legend>
              {selected.size} of {items.length} selected
            </legend>
            <div className="recovery-items">
              {items.map((item) => (
                <label key={item.id} className="recovery-item">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.source === 'snapshot'
                        ? `Unsaved ${item.snapshot?.reason ?? 'autosave'} snapshot`
                        : 'Saved file'}{' '}
                      · {item.path ?? 'Unsaved document'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p>No recovery snapshots or session documents are available.</p>
        )}
        <footer>
          <button
            type="button"
            disabled={!selectedItems.length || Boolean(busy)}
            onClick={() => void perform('restore')}
          >
            {busy === 'restore' ? 'Restoring…' : 'Restore selected'}
          </button>
          <button
            className="danger"
            type="button"
            disabled={!selectedItems.length || Boolean(busy)}
            onClick={() => void perform('discard')}
          >
            {busy === 'discard' ? 'Discarding…' : 'Discard selected'}
          </button>
        </footer>
        <p className="recovery-live" role="status" aria-live="polite">
          {busy ? `${busy} in progress` : ''}
        </p>
    </Dialog>
  );
}
