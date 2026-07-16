import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  WorkspaceReplacePreviewRecord,
  WorkspaceReplaceResultRecord,
  WorkspaceSearchOptions,
  WorkspaceSearchProgressRecord,
  WorkspaceSearchResultRecord,
} from '../../shared/contracts';
import './workspace-search.css';

export interface WorkspaceSearchPanelProps {
  workspaceRoot: string;
  onOpenResult(path: string, line: number, column: number): void;
  onFilesChanged?(): void;
}

const splitPatterns = (value: string) =>
  value
    .split(/[,;\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export function WorkspaceSearchPanel({
  workspaceRoot,
  onOpenResult,
  onFilesChanged,
}: WorkspaceSearchPanelProps) {
  const titleId = useId();
  const statusId = useId();
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();
  const applyPreviewButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState<'filename' | 'content' | 'both'>('content');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [includeGlobs, setIncludeGlobs] = useState('**/*.md, **/*.markdown');
  const [excludeGlobs, setExcludeGlobs] = useState('');
  const [ignoredDirectories, setIgnoredDirectories] = useState('');
  const [respectGitignore, setRespectGitignore] = useState(true);
  const [result, setResult] = useState<WorkspaceSearchResultRecord>();
  const [preview, setPreview] = useState<WorkspaceReplacePreviewRecord>();
  const [replaceResult, setReplaceResult] = useState<WorkspaceReplaceResultRecord>();
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());
  const [operationId, setOperationId] = useState<string>();
  const [progress, setProgress] = useState<WorkspaceSearchProgressRecord>();
  const [busy, setBusy] = useState<'search' | 'preview' | 'apply'>();
  const [error, setError] = useState('');
  const [confirmApply, setConfirmApply] = useState(false);

  useEffect(
    () =>
      window.markora.onWorkspaceSearchProgress((next) => {
        if (next.operationId === operationId) setProgress(next);
      }),
    [operationId],
  );

  useEffect(() => {
    setResult(undefined);
    setPreview(undefined);
    setReplaceResult(undefined);
    setSelectedMatches(new Set());
  }, [workspaceRoot]);

  useEffect(() => {
    if (!confirmApply) return;
    confirmationRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      if (applyPreviewButtonRef.current?.isConnected) applyPreviewButtonRef.current.focus();
    };
  }, [confirmApply]);

  const searchOptions = (): WorkspaceSearchOptions => ({
    workspaceRoot,
    query,
    scope,
    regex,
    caseSensitive,
    wholeWord,
    includeGlobs: splitPatterns(includeGlobs),
    excludeGlobs: splitPatterns(excludeGlobs),
    ignoredDirectories: splitPatterns(ignoredDirectories),
    respectGitignore,
  });
  const contentMatchIds = useMemo(
    () =>
      result?.files.flatMap((file) =>
        file.matches.filter((match) => match.kind === 'content').map((match) => match.id),
      ) || [],
    [result],
  );

  const executeSearch = async () => {
    if (!query.trim() || !workspaceRoot || busy) return;
    if (preview) {
      void window.markora.discardWorkspaceReplace({
        operationId: crypto.randomUUID(),
        previewToken: preview.previewToken,
      });
    }
    const id = crypto.randomUUID();
    setOperationId(id);
    setBusy('search');
    setError('');
    setPreview(undefined);
    setReplaceResult(undefined);
    setConfirmApply(false);
    try {
      const next = await window.markora.searchWorkspaceAdvanced({ operationId: id, search: searchOptions() });
      setResult(next);
      setSelectedMatches(
        new Set(
          next.files.flatMap((file) =>
            file.matches.filter((match) => match.kind === 'content').map((match) => match.id),
          ),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace search failed.');
    } finally {
      setBusy(undefined);
      setOperationId(undefined);
    }
  };

  const createPreview = async () => {
    if (!result || !selectedMatches.size || busy) return;
    const id = crypto.randomUUID();
    setOperationId(id);
    setBusy('preview');
    setError('');
    setReplaceResult(undefined);
    try {
      setPreview(
        await window.markora.previewWorkspaceReplace({
          operationId: id,
          search: searchOptions(),
          replacement,
          selection: { includeMatchIds: Array.from(selectedMatches) },
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Replace preview failed.');
    } finally {
      setBusy(undefined);
      setOperationId(undefined);
    }
  };

  const applyPreview = async () => {
    if (!preview || busy) return;
    const id = crypto.randomUUID();
    setOperationId(id);
    setBusy('apply');
    setError('');
    try {
      const applied = await window.markora.applyWorkspaceReplace({
        operationId: id,
        previewToken: preview.previewToken,
        confirmationToken: preview.confirmationToken,
        confirmed: true,
        createBackups: true,
      });
      setReplaceResult(applied);
      setPreview(undefined);
      setConfirmApply(false);
      onFilesChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace replacement failed.');
    } finally {
      setBusy(undefined);
      setOperationId(undefined);
    }
  };

  const setFileSelected = (ids: string[], selected: boolean) => {
    setSelectedMatches((current) => {
      const next = new Set(current);
      ids.forEach((id) => (selected ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  return (
    <section
      className="workspace-search-panel"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      aria-busy={Boolean(busy)}
    >
      <h2 id={titleId} className="workspace-search-visually-hidden">
        Workspace search and replace
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void executeSearch();
        }}
      >
        <label>
          Search workspace
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find text or filenames"
          />
        </label>
        <div className="workspace-search-row">
          <select
            aria-label="Search scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="content">Content</option>
            <option value="filename">Filenames</option>
            <option value="both">Content and filenames</option>
          </select>
          <button
            type="button"
            aria-label="Match case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive(!caseSensitive)}
            title="Match case"
          >
            Aa
          </button>
          <button
            type="button"
            aria-label="Match whole word"
            aria-pressed={wholeWord}
            onClick={() => setWholeWord(!wholeWord)}
            title="Whole word"
          >
            Word
          </button>
          <button
            type="button"
            aria-label="Use regular expression"
            aria-pressed={regex}
            onClick={() => setRegex(!regex)}
            title="Regular expression"
          >
            .*
          </button>
          <button type="submit" disabled={!query.trim() || Boolean(busy)}>
            {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
          {busy && (
            <button
              type="button"
              onClick={() => operationId && void window.markora.cancelWorkspaceOperation(operationId)}
            >
              Cancel
            </button>
          )}
        </div>
        <details>
          <summary>Files and ignore patterns</summary>
          <label>
            Include globs
            <input
              value={includeGlobs}
              onChange={(event) => setIncludeGlobs(event.target.value)}
              placeholder="**/*.md"
            />
          </label>
          <label>
            Exclude globs
            <input
              value={excludeGlobs}
              onChange={(event) => setExcludeGlobs(event.target.value)}
              placeholder="drafts/**"
            />
          </label>
          <label>
            Ignored directories
            <input
              value={ignoredDirectories}
              onChange={(event) => setIgnoredDirectories(event.target.value)}
              placeholder="vendor, generated"
            />
          </label>
          <label className="workspace-check">
            <input
              type="checkbox"
              checked={respectGitignore}
              onChange={(event) => setRespectGitignore(event.target.checked)}
            />{' '}
            Respect .gitignore
          </label>
          <p>
            Always ignored: .git, node_modules, dist, release, build outputs, application caches, and .markora
            backups.
          </p>
        </details>
      </form>
      <div
        id={statusId}
        className="workspace-search-visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {busy
          ? progress
            ? `${progress.phase}: ${progress.searchedFiles} of ${progress.discoveredFiles} files, ${progress.matchCount} matches.`
            : `${busy} started.`
          : replaceResult
            ? `Replaced ${replaceResult.replacedMatchCount} matches in ${replaceResult.replacedFileCount} files.`
            : result
              ? `${result.matchCount} matches in ${result.matchedFileCount} files.`
              : ''}
      </div>
      {progress && busy && (
        <p aria-hidden="true">
          {progress.phase}: {progress.searchedFiles}/{progress.discoveredFiles} files · {progress.matchCount}{' '}
          matches
        </p>
      )}
      {error && (
        <p className="workspace-search-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p>
            {result.matchCount} matches in {result.matchedFileCount} files ({result.durationMs} ms)
            {result.truncated ? ' · truncated' : ''}
          </p>
          <label>
            Replace with
            <input
              value={replacement}
              onChange={(event) => {
                setReplacement(event.target.value);
                setPreview(undefined);
                setConfirmApply(false);
              }}
            />
          </label>
          <div className="workspace-search-row">
            <button type="button" onClick={() => setFileSelected(contentMatchIds, true)}>
              Select all content matches
            </button>
            <button type="button" onClick={() => setSelectedMatches(new Set())}>
              Clear selection
            </button>
            <button
              type="button"
              disabled={!selectedMatches.size || Boolean(busy)}
              onClick={() => void createPreview()}
            >
              Preview selected replacements
            </button>
          </div>
          <div className="workspace-search-results" role="list" aria-label="Workspace search results">
            {result.files.map((file) => {
              const contentIds = file.matches
                .filter((match) => match.kind === 'content')
                .map((match) => match.id);
              const selectedCount = contentIds.filter((id) => selectedMatches.has(id)).length;
              return (
                <details open key={file.id} role="listitem">
                  <summary>
                    {file.relativePath} <span>{file.matches.length}</span>
                  </summary>
                  {contentIds.length > 0 && (
                    <label className="workspace-search-file-select">
                      <input
                        aria-label={`Select all content matches in ${file.relativePath}`}
                        type="checkbox"
                        checked={selectedCount === contentIds.length}
                        ref={(input) => {
                          if (input)
                            input.indeterminate = selectedCount > 0 && selectedCount < contentIds.length;
                        }}
                        onChange={(event) => setFileSelected(contentIds, event.target.checked)}
                      />
                      Select all in file
                    </label>
                  )}
                  <div role="group" aria-label={`Matches in ${file.relativePath}`}>
                    {file.matches.map((match) => (
                      <div className="workspace-search-match" key={match.id}>
                        {match.kind === 'content' ? (
                          <input
                            type="checkbox"
                            aria-label={`Select match at line ${match.line}, column ${match.column} in ${file.relativePath}`}
                            checked={selectedMatches.has(match.id)}
                            onChange={(event) => setFileSelected([match.id], event.target.checked)}
                          />
                        ) : (
                          <span className="workspace-search-match-spacer" aria-hidden="true" />
                        )}
                        <button
                          type="button"
                          aria-label={`Open ${file.relativePath} at ${match.kind === 'filename' ? 'filename match' : `line ${match.line}, column ${match.column}`}`}
                          onClick={() => onOpenResult(file.path, match.line, match.column)}
                        >
                          <strong>
                            {match.kind === 'filename' ? 'filename' : `${match.line}:${match.column}`}
                          </strong>
                          <span>{match.preview}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
          {result.failures.length > 0 && (
            <details>
              <summary>{result.failures.length} search failures</summary>
              {result.failures.map((failure) => (
                <p key={`${failure.path}-${failure.code}`}>
                  {failure.relativePath || failure.path}: {failure.message}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      {preview && (
        <section className="workspace-replace-preview" aria-label="Workspace replacement preview">
          <h3>Replace preview</h3>
          <p>
            {preview.selectedMatchCount} replacements in {preview.selectedFileCount} files. Backups will be
            created before any write.
          </p>
          {preview.files.map((file) => (
            <details open key={file.id}>
              <summary>
                {file.relativePath} · {file.selectedMatchCount}
              </summary>
              {file.matches
                .filter((match) => match.selected)
                .map((match) => (
                  <p key={match.id}>
                    <del>{match.matchedText}</del> → <ins>{match.replacementText || '(empty)'}</ins>
                  </p>
                ))}
            </details>
          ))}
          {!confirmApply ? (
            <button ref={applyPreviewButtonRef} type="button" onClick={() => setConfirmApply(true)}>
              Apply preview…
            </button>
          ) : (
            <div
              ref={confirmationRef}
              className="workspace-confirm"
              role="alertdialog"
              aria-labelledby={confirmationTitleId}
              aria-describedby={confirmationDescriptionId}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setConfirmApply(false);
                  return;
                }
                if (event.key !== 'Tab' || !confirmationRef.current) return;
                const buttons = Array.from(
                  confirmationRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
                );
                const first = buttons[0];
                const last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
            >
              <strong id={confirmationTitleId}>Confirm workspace replacement</strong>
              <span id={confirmationDescriptionId}>
                Apply changes to {preview.selectedFileCount} files? Backups are created first.
              </span>
              <button type="button" onClick={() => void applyPreview()}>
                Confirm, back up, and replace
              </button>
              <button type="button" onClick={() => setConfirmApply(false)}>
                Cancel
              </button>
            </div>
          )}
        </section>
      )}
      {replaceResult && (
        <section aria-label="Workspace replacement result">
          <strong>
            Replaced {replaceResult.replacedMatchCount} matches in {replaceResult.replacedFileCount} files.
          </strong>
          <p>Backups: {replaceResult.backupRoot}</p>
          {replaceResult.files
            .filter((file) => file.status !== 'replaced')
            .map((file) => (
              <p key={file.fileId}>
                {file.relativePath}: {file.message || file.status}
              </p>
            ))}
        </section>
      )}
    </section>
  );
}
