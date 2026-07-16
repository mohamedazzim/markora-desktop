import React, { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ShortcutError,
  ShortcutRecorder,
  type ShortcutConflictResolution,
  type ShortcutManager,
} from './shortcuts';
import './shortcut-settings.css';
import { Dialog } from '../components/Dialog';

interface PendingConflict {
  readonly kind: 'assign' | 'reset';
  readonly commandId: string;
  readonly shortcut: string;
  readonly conflicts: readonly string[];
}

export interface ShortcutSettingsPanelProps<TContext> {
  readonly manager: ShortcutManager<TContext>;
  /** Opens the host file picker and returns the selected shortcut JSON contents. */
  readonly onRequestImport?: () => string | null | Promise<string | null>;
  /** Lets the host save/copy the already validated, versioned JSON payload. */
  readonly onExport?: (serialized: string, suggestedFileName: string) => void | Promise<void>;
  readonly title?: string;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ShortcutAlertDialog({
  labelledBy,
  label,
  onCancel,
  children,
}: {
  labelledBy?: string;
  label?: string;
  onCancel(): void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open
      contentRef={dialogRef}
      className="shortcut-settings-dialog"
      size="small"
      role="alertdialog"
      ariaLabel={labelledBy ? undefined : label}
      labelledBy={labelledBy}
      onClose={onCancel}
      onEscape={onCancel}
      initialFocus="[data-autofocus]"
    >
      {children}
    </Dialog>
  );
}

export function ShortcutSettingsPanel<TContext>({
  manager,
  onRequestImport,
  onExport,
  title = 'Keyboard shortcuts',
}: ShortcutSettingsPanelProps<TContext>) {
  const [query, setQuery] = useState('');
  const [recordingCommandId, setRecordingCommandId] = useState<string>();
  const [recordedShortcut, setRecordedShortcut] = useState('');
  const [pendingConflict, setPendingConflict] = useState<PendingConflict>();
  const [pendingImport, setPendingImport] = useState<string>();
  const [pastedSettings, setPastedSettings] = useState('');
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [busy, setBusy] = useState<'import' | 'export'>();
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const recorderRef = useRef<ShortcutRecorder | undefined>(undefined);
  const recordingButtonRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const pasteId = useId();
  const titleId = useId();
  const conflictTitleId = useId();
  const resetTitleId = useId();

  const refresh = () => setRevision((value) => value + 1);
  const commandLabel = (commandId: string) => manager.registry.get(commandId)?.label ?? commandId;

  const mutate = (operation: () => void, successMessage: string): boolean => {
    try {
      operation();
      setError('');
      setAnnouncement(successMessage);
      refresh();
      return true;
    } catch (mutationError) {
      setError(messageFromError(mutationError));
      setAnnouncement('Shortcut settings were not changed.');
      return false;
    }
  };

  useEffect(() => {
    if (!recordingCommandId) {
      recorderRef.current = undefined;
      return;
    }
    const commandId = recordingCommandId;
    const recorder = new ShortcutRecorder({
      maximumStrokes: 2,
      chordTimeoutMs: 1_200,
      onChange: (shortcut) => {
        setRecordedShortcut(shortcut);
        setAnnouncement(`${shortcut}. Press another key for a chord, or wait to finish.`);
      },
      onComplete: (shortcut) => {
        const conflicts = manager.conflictsFor(shortcut, commandId);
        if (conflicts.length) {
          setPendingConflict({ kind: 'assign', commandId, shortcut, conflicts });
          setAnnouncement(`${shortcut} conflicts with ${conflicts.map(commandLabel).join(', ')}.`);
        } else {
          mutate(
            () => manager.assign(commandId, shortcut),
            `${commandLabel(commandId)} is now assigned to ${shortcut}.`,
          );
        }
        setRecordingCommandId(undefined);
      },
      onCancel: () => {
        setRecordingCommandId(undefined);
        setRecordedShortcut('');
        setAnnouncement('Shortcut recording cancelled.');
      },
    });
    recorderRef.current = recorder;
    setRecordedShortcut('');
    setError('');
    setAnnouncement(`Recording ${commandLabel(commandId)}. Press a shortcut, or Escape to cancel.`);
    const frame = window.requestAnimationFrame(() => recordingButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      recorder.dispose();
      if (recorderRef.current === recorder) recorderRef.current = undefined;
    };
  }, [manager, recordingCommandId]);

  const commands = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return manager.registry
      .list()
      .filter((command) => {
        if (!needle) return true;
        const shortcut = manager.bindingFor(command.id) ?? '';
        return [command.label, command.id, command.category, shortcut]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle);
      })
      .sort(
        (left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label),
      );
  }, [manager, query, revision]);

  const applyConflict = (resolution: ShortcutConflictResolution) => {
    if (!pendingConflict) return;
    const { commandId, kind, shortcut } = pendingConflict;
    if (resolution === 'reject') {
      setPendingConflict(undefined);
      setAnnouncement(`Kept the existing shortcut for ${commandLabel(commandId)}.`);
      return;
    }
    const succeeded = mutate(
      () => {
        if (kind === 'assign') manager.assign(commandId, shortcut, resolution);
        else manager.reset(commandId, 'replace');
      },
      kind === 'assign'
        ? `${commandLabel(commandId)} is now assigned to ${shortcut}.`
        : `${commandLabel(commandId)} was reset to ${shortcut}.`,
    );
    if (succeeded) setPendingConflict(undefined);
  };

  const resetOne = (commandId: string) => {
    const command = manager.registry.require(commandId);
    try {
      manager.reset(commandId);
      setError('');
      setAnnouncement(`${command.label} was reset to its default shortcut.`);
      refresh();
    } catch (resetError) {
      if (resetError instanceof ShortcutError && resetError.code === 'CONFLICT') {
        const shortcut = command.defaultShortcut ?? 'Unassigned';
        setPendingConflict({
          kind: 'reset',
          commandId,
          shortcut,
          conflicts: resetError.conflicts ?? [],
        });
        setAnnouncement(`${shortcut} is already assigned. Choose how to resolve the conflict.`);
      } else {
        setError(messageFromError(resetError));
      }
    }
  };

  const importSerialized = (serialized: string) => {
    try {
      const result = manager.importSettings(serialized, 'reject');
      setPendingImport(undefined);
      setError('');
      setAnnouncement(
        `Imported ${result.importedCommandIds.length} shortcuts${
          result.ignoredCommandIds.length
            ? `; ignored ${result.ignoredCommandIds.length} unknown commands`
            : ''
        }.`,
      );
      refresh();
    } catch (importError) {
      if (importError instanceof ShortcutError && importError.code === 'CONFLICT') {
        setPendingImport(serialized);
        setAnnouncement('Imported shortcuts conflict with current defaults or each other.');
      } else {
        setError(messageFromError(importError));
        setAnnouncement('Shortcut import failed.');
      }
    }
  };

  const requestImport = async () => {
    if (!onRequestImport || busy) return;
    setBusy('import');
    try {
      const serialized = await onRequestImport();
      if (serialized) importSerialized(serialized);
      else setAnnouncement('Shortcut import cancelled.');
    } catch (importError) {
      setError(messageFromError(importError));
      setAnnouncement('Shortcut import failed.');
    } finally {
      setBusy(undefined);
    }
  };

  const exportSettings = async () => {
    if (!onExport || busy) return;
    setBusy('export');
    try {
      await onExport(manager.exportSettings(), 'markora-shortcuts.json');
      setError('');
      setAnnouncement('Shortcut settings exported.');
    } catch (exportError) {
      setError(messageFromError(exportError));
      setAnnouncement('Shortcut export failed.');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="shortcut-settings" aria-labelledby={titleId}>
      <header className="shortcut-settings-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          <p>Customize commands with single keys or multi-key chords.</p>
        </div>
        <div className="shortcut-settings-header-actions">
          {onRequestImport ? (
            <button type="button" onClick={() => void requestImport()} disabled={Boolean(busy)}>
              {busy === 'import' ? 'Importing…' : 'Import file…'}
            </button>
          ) : null}
          {onExport ? (
            <button type="button" onClick={() => void exportSettings()} disabled={Boolean(busy)}>
              {busy === 'export' ? 'Exporting…' : 'Export…'}
            </button>
          ) : null}
          <button type="button" onClick={() => setConfirmResetAll(true)}>
            Reset all
          </button>
        </div>
      </header>

      <div className="shortcut-settings-search-row">
        <label htmlFor={searchId}>Search commands</label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-describedby={`${searchId}-count`}
        />
        <span id={`${searchId}-count`}>
          {commands.length} {commands.length === 1 ? 'command' : 'commands'}
        </span>
      </div>

      <div className="shortcut-settings-import">
        <label htmlFor={pasteId}>Paste shortcut settings JSON</label>
        <textarea
          id={pasteId}
          rows={3}
          value={pastedSettings}
          onChange={(event) => setPastedSettings(event.currentTarget.value)}
          placeholder='{"schema":"markora.shortcuts","version":2,…}'
        />
        <button
          type="button"
          disabled={!pastedSettings.trim()}
          onClick={() => importSerialized(pastedSettings)}
        >
          Import pasted JSON
        </button>
      </div>

      {error ? (
        <p className="shortcut-settings-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="shortcut-settings-live" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <ul className="shortcut-settings-list" aria-label="Configurable shortcuts">
        {commands.map((command) => {
          const current = manager.bindingFor(command.id);
          const recording = recordingCommandId === command.id;
          return (
            <li key={command.id} className="shortcut-settings-item">
              <span className="shortcut-settings-command">
                <strong>{command.label}</strong>
                <span>
                  {command.category} · {command.id}
                </span>
              </span>
              <span
                className="shortcut-settings-binding"
                aria-label={`Current shortcut: ${current ?? 'Unassigned'}`}
              >
                {current ? <kbd>{current}</kbd> : <em>Unassigned</em>}
              </span>
              <span className="shortcut-settings-actions">
                <button
                  ref={recording ? recordingButtonRef : undefined}
                  type="button"
                  className={recording ? 'is-recording' : undefined}
                  aria-pressed={recording}
                  aria-label={
                    recording
                      ? `Recording shortcut for ${command.label}. Press keys or Escape to cancel.`
                      : `Record shortcut for ${command.label}`
                  }
                  onClick={() => {
                    if (recording) {
                      recorderRef.current?.cancel();
                    } else {
                      setRecordingCommandId(command.id);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (recording) recorderRef.current?.handleKeyDown(event.nativeEvent);
                  }}
                >
                  {recording ? recordedShortcut || 'Press keys…' : 'Record'}
                </button>
                <button type="button" onClick={() => resetOne(command.id)}>
                  Reset
                  <span className="shortcut-settings-sr-only"> {command.label}</span>
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {commands.length === 0 ? <p className="shortcut-settings-empty">No matching commands.</p> : null}

      {pendingConflict ? (
        <ShortcutAlertDialog labelledBy={conflictTitleId} onCancel={() => applyConflict('reject')}>
          <h3 id={conflictTitleId}>Shortcut conflict</h3>
          <p>
            <kbd>{pendingConflict.shortcut}</kbd> is assigned to{' '}
            {pendingConflict.conflicts.length
              ? pendingConflict.conflicts.map(commandLabel).join(', ')
              : 'another command'}
            .
          </p>
          <div>
            <button type="button" data-autofocus onClick={() => applyConflict('reject')}>
              Keep existing
            </button>
            <button type="button" onClick={() => applyConflict('replace')}>
              Replace existing
            </button>
            {pendingConflict.kind === 'assign' && pendingConflict.conflicts.length === 1 ? (
              <button type="button" onClick={() => applyConflict('swap')}>
                Swap shortcuts
              </button>
            ) : null}
          </div>
        </ShortcutAlertDialog>
      ) : null}

      {pendingImport ? (
        <ShortcutAlertDialog
          label="Import conflicts"
          onCancel={() => {
            setPendingImport(undefined);
            setAnnouncement('Shortcut import cancelled.');
          }}
        >
          <h3>Import conflicts</h3>
          <p>Some imported shortcuts conflict. Replace the existing assignments?</p>
          <div>
            <button
              type="button"
              data-autofocus
              onClick={() => {
                setPendingImport(undefined);
                setAnnouncement('Shortcut import cancelled.');
              }}
            >
              Cancel import
            </button>
            <button
              type="button"
              onClick={() => {
                const serialized = pendingImport;
                const succeeded = mutate(
                  () => manager.importSettings(serialized, 'replace'),
                  'Shortcut settings imported and conflicts replaced.',
                );
                if (succeeded) setPendingImport(undefined);
              }}
            >
              Replace conflicts
            </button>
          </div>
        </ShortcutAlertDialog>
      ) : null}

      {confirmResetAll ? (
        <ShortcutAlertDialog labelledBy={resetTitleId} onCancel={() => setConfirmResetAll(false)}>
          <h3 id={resetTitleId}>Reset every shortcut?</h3>
          <p>All custom shortcut assignments will return to their defaults.</p>
          <div>
            <button type="button" data-autofocus onClick={() => setConfirmResetAll(false)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const succeeded = mutate(
                  () => manager.resetAll(),
                  'All shortcuts were reset to their defaults.',
                );
                if (succeeded) setConfirmResetAll(false);
              }}
            >
              Reset all shortcuts
            </button>
          </div>
        </ShortcutAlertDialog>
      ) : null}
    </section>
  );
}
