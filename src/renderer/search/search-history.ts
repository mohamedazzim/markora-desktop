export const SEARCH_HISTORY_VERSION = 1 as const;
export const DEFAULT_SEARCH_HISTORY_LIMIT = 30;

export interface SearchHistoryEntry {
  readonly query: string;
  readonly replacement?: string;
  readonly regularExpression: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly usedAt: number;
}

export interface SearchHistoryState {
  readonly version: typeof SEARCH_HISTORY_VERSION;
  readonly limit: number;
  readonly entries: readonly SearchHistoryEntry[];
}

export type NewSearchHistoryEntry = Omit<SearchHistoryEntry, 'usedAt'> & { readonly usedAt?: number };

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return DEFAULT_SEARCH_HISTORY_LIMIT;
  return Math.min(value, 100);
}

export function createSearchHistory(limit = DEFAULT_SEARCH_HISTORY_LIMIT): SearchHistoryState {
  return { version: SEARCH_HISTORY_VERSION, limit: boundedLimit(limit), entries: [] };
}

function sameSearch(left: SearchHistoryEntry, right: NewSearchHistoryEntry): boolean {
  return (
    left.query === right.query &&
    left.regularExpression === right.regularExpression &&
    left.caseSensitive === right.caseSensitive &&
    left.wholeWord === right.wholeWord
  );
}

export function addSearchHistoryEntry(
  history: SearchHistoryState,
  entry: NewSearchHistoryEntry,
  now = Date.now(),
): SearchHistoryState {
  if (!entry.query || entry.query.length > 2_000 || (entry.replacement?.length ?? 0) > 2_000) {
    return history;
  }
  const normalized: SearchHistoryEntry = {
    query: entry.query,
    replacement: entry.replacement,
    regularExpression: entry.regularExpression,
    caseSensitive: entry.caseSensitive,
    wholeWord: entry.wholeWord,
    usedAt: Number.isFinite(entry.usedAt) ? entry.usedAt! : now,
  };
  const entries = [normalized, ...history.entries.filter((item) => !sameSearch(item, entry))].slice(
    0,
    boundedLimit(history.limit),
  );
  return { version: SEARCH_HISTORY_VERSION, limit: boundedLimit(history.limit), entries };
}

function isHistoryEntry(value: unknown): value is SearchHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SearchHistoryEntry>;
  return (
    typeof candidate.query === 'string' &&
    candidate.query.length > 0 &&
    candidate.query.length <= 2_000 &&
    (candidate.replacement === undefined ||
      (typeof candidate.replacement === 'string' && candidate.replacement.length <= 2_000)) &&
    typeof candidate.regularExpression === 'boolean' &&
    typeof candidate.caseSensitive === 'boolean' &&
    typeof candidate.wholeWord === 'boolean' &&
    typeof candidate.usedAt === 'number' &&
    Number.isFinite(candidate.usedAt)
  );
}

/** Loads only the current persistence version and safely rejects malformed data. */
export function parseSearchHistory(
  persisted: string | unknown,
  fallbackLimit = DEFAULT_SEARCH_HISTORY_LIMIT,
): SearchHistoryState {
  let value: unknown = persisted;
  if (typeof persisted === 'string') {
    try {
      value = JSON.parse(persisted) as unknown;
    } catch {
      return createSearchHistory(fallbackLimit);
    }
  }
  if (!value || typeof value !== 'object') return createSearchHistory(fallbackLimit);
  const candidate = value as Partial<SearchHistoryState>;
  if (candidate.version !== SEARCH_HISTORY_VERSION || !Array.isArray(candidate.entries)) {
    return createSearchHistory(fallbackLimit);
  }
  const limit = boundedLimit(candidate.limit ?? fallbackLimit);
  const entries = candidate.entries
    .filter(isHistoryEntry)
    .sort((left, right) => right.usedAt - left.usedAt)
    .slice(0, limit);
  return { version: SEARCH_HISTORY_VERSION, limit, entries };
}

export function serializeSearchHistory(history: SearchHistoryState): string {
  return JSON.stringify(parseSearchHistory(history, history.limit));
}
