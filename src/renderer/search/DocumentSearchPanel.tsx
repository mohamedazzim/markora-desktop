import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  createReplaceAllConfirmation,
  navigateSearchMatches,
  replaceAllSearchMatches,
  replaceSearchMatch,
  searchDocument,
  type DocumentReplacement,
  type DocumentSearchError,
  type DocumentSearchMatch,
  type ReplaceConfirmationMetadata,
  type TextRange,
} from './document-search';
import { addSearchHistoryEntry, createSearchHistory, type SearchHistoryState } from './search-history';
import './document-search.css';

export interface SearchHighlightData {
  readonly query: string;
  readonly matches: readonly DocumentSearchMatch[];
  readonly activeIndex: number;
  readonly activeMatch: DocumentSearchMatch | null;
  readonly scope: TextRange;
  readonly error?: DocumentSearchError;
  readonly truncated: boolean;
}

export interface SearchNavigationEvent {
  readonly match: DocumentSearchMatch;
  readonly index: number;
  readonly direction: 'next' | 'previous';
  readonly wrapped: boolean;
}

export interface SearchReplacementEvent extends DocumentReplacement {
  readonly kind: 'replace-one' | 'replace-all';
}

export interface DocumentSearchPanelProps {
  readonly open: boolean;
  readonly documentText: string;
  readonly selection?: TextRange;
  readonly initialReplaceMode?: boolean;
  readonly initialHistory?: SearchHistoryState;
  readonly onClose: () => void;
  readonly onNavigate: (event: SearchNavigationEvent) => void;
  readonly onHighlightsChange: (highlights: SearchHighlightData) => void;
  readonly onApplyReplacement: (event: SearchReplacementEvent) => void;
  readonly onHistoryChange?: (history: SearchHistoryState) => void;
}

function hasUsableSelection(selection: TextRange | undefined): selection is TextRange {
  return Boolean(selection && selection.start !== selection.end);
}

export function DocumentSearchPanel({
  open,
  documentText,
  selection,
  initialReplaceMode = false,
  initialHistory,
  onClose,
  onNavigate,
  onHighlightsChange,
  onApplyReplacement,
  onHistoryChange,
}: DocumentSearchPanelProps) {
  const titleId = useId();
  const statusId = useId();
  const replaceRowId = useId();
  const confirmationTitleId = useId();
  const confirmationDescriptionId = useId();
  const findInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const replaceAllTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const highlightsCallbackRef = useRef(onHighlightsChange);
  const documentLengthRef = useRef(documentText.length);
  highlightsCallbackRef.current = onHighlightsChange;
  documentLengthRef.current = documentText.length;
  const [replaceMode, setReplaceMode] = useState(initialReplaceMode);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regularExpression, setRegularExpression] = useState(false);
  const [searchInSelection, setSearchInSelection] = useState(false);
  const [selectionScope, setSelectionScope] = useState<TextRange>();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState('');
  const [history, setHistory] = useState<SearchHistoryState>(initialHistory ?? createSearchHistory());
  const historyRef = useRef(history);
  historyRef.current = history;
  const [pendingReplaceAll, setPendingReplaceAll] = useState<ReplaceConfirmationMetadata | null>(null);

  const options = useMemo(
    () => ({
      query,
      regularExpression,
      caseSensitive,
      wholeWord,
      selection: searchInSelection ? selectionScope : undefined,
    }),
    [caseSensitive, query, regularExpression, searchInSelection, selectionScope, wholeWord],
  );
  const result = useMemo(() => searchDocument(documentText, options), [documentText, options]);
  const activeMatch = activeIndex >= 0 ? (result.matches[activeIndex] ?? null) : null;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    findInputRef.current?.focus();
    findInputRef.current?.select();
    return () => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!pendingReplaceAll) return;
    confirmationRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      if (replaceAllTriggerRef.current?.isConnected) replaceAllTriggerRef.current.focus();
    };
  }, [pendingReplaceAll]);

  useEffect(() => {
    setActiveIndex(-1);
    setAnnouncement('');
  }, [documentText, options]);

  useEffect(() => {
    setPendingReplaceAll(null);
  }, [documentText, options, replacement]);

  useEffect(() => {
    if (!open) return;
    highlightsCallbackRef.current({
      query,
      matches: result.matches,
      activeIndex,
      activeMatch,
      scope: result.scope,
      error: result.error,
      truncated: result.truncated,
    });
  }, [activeIndex, activeMatch, open, query, result]);

  useEffect(() => {
    const clearHighlights = () =>
      highlightsCallbackRef.current({
        query: '',
        matches: [],
        activeIndex: -1,
        activeMatch: null,
        scope: { start: 0, end: documentLengthRef.current },
        truncated: false,
      });
    if (!open) {
      clearHighlights();
      return;
    }
    return clearHighlights;
  }, [open]);

  if (!open) return null;

  const recordHistory = () => {
    if (!query) return;
    const next = addSearchHistoryEntry(historyRef.current, {
      query,
      replacement: replaceMode ? replacement : undefined,
      regularExpression,
      caseSensitive,
      wholeWord,
    });
    historyRef.current = next;
    setHistory(next);
    onHistoryChange?.(next);
  };

  const navigate = (direction: 'next' | 'previous') => {
    const navigation = navigateSearchMatches(result.matches, activeIndex, direction);
    if (!navigation) {
      setAnnouncement(query ? 'No matches found.' : 'Enter text to search.');
      return;
    }
    setActiveIndex(navigation.index);
    setAnnouncement(
      `${navigation.index + 1} of ${result.matches.length}${navigation.wrapped ? ', wrapped' : ''}`,
    );
    recordHistory();
    onNavigate(navigation);
  };

  const replaceOne = () => {
    const target = activeMatch ?? result.matches[0];
    if (!target) {
      setAnnouncement('No match available to replace.');
      return;
    }
    recordHistory();
    onApplyReplacement({
      kind: 'replace-one',
      ...replaceSearchMatch(documentText, target, replacement, regularExpression),
    });
  };

  const previewReplaceAll = () => {
    if (result.matches.length === 0) {
      setAnnouncement('No matches available to replace.');
      return;
    }
    setPendingReplaceAll(createReplaceAllConfirmation(result, options, replacement));
  };

  const confirmReplaceAll = () => {
    if (!pendingReplaceAll) return;
    recordHistory();
    onApplyReplacement({
      kind: 'replace-all',
      ...replaceAllSearchMatches(documentText, result, options, replacement),
    });
    setPendingReplaceAll(null);
  };

  const restoreHistory = (usedAt: string) => {
    const entry = history.entries.find((item) => String(item.usedAt) === usedAt);
    if (!entry) return;
    setQuery(entry.query);
    setReplacement(entry.replacement ?? '');
    setRegularExpression(entry.regularExpression);
    setCaseSensitive(entry.caseSensitive);
    setWholeWord(entry.wholeWord);
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (pendingReplaceAll) setPendingReplaceAll(null);
      else onClose();
      return;
    }
    if (event.key === 'F3') {
      event.preventDefault();
      navigate(event.shiftKey ? 'previous' : 'next');
    }
  };

  const handleFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    navigate(event.shiftKey ? 'previous' : 'next');
  };

  const countText = result.error
    ? result.error.message
    : !query
      ? 'Enter text to search'
      : result.matches.length === 0
        ? 'No matches'
        : activeMatch
          ? `${activeIndex + 1} of ${result.matches.length}`
          : `${result.matches.length} ${result.matches.length === 1 ? 'match' : 'matches'}`;

  return (
    <section
      className="document-search-panel"
      role="search"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      onKeyDown={handlePanelKeyDown}
    >
      <h2 id={titleId} className="document-search-visually-hidden">
        Find and replace in current document
      </h2>
      <div className="document-search-row">
        <button
          type="button"
          className="document-search-expand"
          aria-label={replaceMode ? 'Hide replace controls' : 'Show replace controls'}
          aria-expanded={replaceMode}
          aria-controls={replaceRowId}
          onClick={() => setReplaceMode((visible) => !visible)}
        >
          {replaceMode ? '▾' : '▸'}
        </button>
        <label className="document-search-input-label">
          <span className="document-search-visually-hidden">Find</span>
          <input
            ref={findInputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleFindKeyDown}
            placeholder="Find"
            aria-keyshortcuts="Enter Shift+Enter F3 Shift+F3"
            spellCheck={false}
          />
        </label>
        <select
          className="document-search-history"
          aria-label="Search history"
          value=""
          onChange={(event) => restoreHistory(event.target.value)}
          disabled={history.entries.length === 0}
        >
          <option value="">Recent searches</option>
          {history.entries.map((entry) => (
            <option key={`${entry.usedAt}-${entry.query}`} value={entry.usedAt}>
              {entry.query}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Match case"
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => setCaseSensitive((enabled) => !enabled)}
        >
          Aa
        </button>
        <button
          type="button"
          aria-label="Match whole word"
          aria-pressed={wholeWord}
          title="Match whole word"
          onClick={() => setWholeWord((enabled) => !enabled)}
        >
          Ab|
        </button>
        <button
          type="button"
          aria-label="Use regular expression"
          aria-pressed={regularExpression}
          title="Use regular expression"
          onClick={() => setRegularExpression((enabled) => !enabled)}
        >
          .*
        </button>
        <button
          type="button"
          aria-label="Search in selection"
          aria-pressed={searchInSelection}
          title={
            searchInSelection
              ? 'Search the captured selection'
              : hasUsableSelection(selection)
                ? 'Search in selection'
                : 'Select document text first'
          }
          disabled={!searchInSelection && !hasUsableSelection(selection)}
          onClick={() => {
            if (searchInSelection) {
              setSearchInSelection(false);
              setSelectionScope(undefined);
            } else if (hasUsableSelection(selection)) {
              setSelectionScope({
                start: Math.min(selection.start, selection.end),
                end: Math.max(selection.start, selection.end),
              });
              setSearchInSelection(true);
            }
          }}
        >
          ◩
        </button>
        <span id={statusId} className="document-search-count" role="status" aria-live="polite">
          {announcement || countText}
        </span>
        <button
          type="button"
          aria-label="Previous match"
          onClick={() => navigate('previous')}
          disabled={result.matches.length === 0}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Next match"
          onClick={() => navigate('next')}
          disabled={result.matches.length === 0}
        >
          ↓
        </button>
        <button type="button" aria-label="Close search" onClick={onClose}>
          ×
        </button>
      </div>

      {replaceMode && (
        <div id={replaceRowId} className="document-search-row document-replace-row">
          <span className="document-search-indent" aria-hidden="true" />
          <label className="document-search-input-label">
            <span className="document-search-visually-hidden">Replace</span>
            <input
              type="text"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              placeholder="Replace"
              spellCheck={false}
            />
          </label>
          <button type="button" onClick={replaceOne} disabled={result.matches.length === 0}>
            Replace
          </button>
          <button
            ref={replaceAllTriggerRef}
            type="button"
            onClick={previewReplaceAll}
            disabled={result.matches.length === 0}
          >
            Replace all
          </button>
        </div>
      )}

      {pendingReplaceAll && (
        <div
          ref={confirmationRef}
          className="document-search-confirmation"
          role="alertdialog"
          aria-labelledby={confirmationTitleId}
          aria-describedby={confirmationDescriptionId}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || !confirmationRef.current) return;
            const controls = Array.from(
              confirmationRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
            );
            if (!controls.length) return;
            const first = controls[0];
            const last = controls.at(-1)!;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <strong id={confirmationTitleId} className="document-search-visually-hidden">
            Confirm replace all
          </strong>
          <span id={confirmationDescriptionId}>
            Replace {pendingReplaceAll.matchCount} {pendingReplaceAll.matchCount === 1 ? 'match' : 'matches'}?
            {pendingReplaceAll.zeroWidthMatchCount > 0 &&
              ` This includes ${pendingReplaceAll.zeroWidthMatchCount} zero-width matches.`}
            {pendingReplaceAll.truncated && ' Search results were truncated.'}
          </span>
          <button type="button" onClick={confirmReplaceAll} disabled={pendingReplaceAll.truncated}>
            Confirm replace all
          </button>
          <button type="button" onClick={() => setPendingReplaceAll(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
