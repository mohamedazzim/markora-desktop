import { describe, expect, it } from 'vitest';
import {
  SEARCH_HISTORY_VERSION,
  addSearchHistoryEntry,
  createSearchHistory,
  parseSearchHistory,
  serializeSearchHistory,
} from '../../src/renderer/search/search-history';

const entry = (query: string, usedAt?: number) => ({
  query,
  regularExpression: false,
  caseSensitive: false,
  wholeWord: false,
  usedAt,
});

describe('versioned bounded search history', () => {
  it('creates the current version with a bounded limit', () => {
    expect(createSearchHistory(5)).toEqual({ version: SEARCH_HISTORY_VERSION, limit: 5, entries: [] });
    expect(createSearchHistory(999).limit).toBe(100);
    expect(createSearchHistory(0).limit).toBe(30);
  });

  it('stores newest entries first and enforces the configured bound', () => {
    let history = createSearchHistory(2);
    history = addSearchHistoryEntry(history, entry('one'), 1);
    history = addSearchHistoryEntry(history, entry('two'), 2);
    history = addSearchHistoryEntry(history, entry('three'), 3);
    expect(history.entries.map((item) => item.query)).toEqual(['three', 'two']);
  });

  it('deduplicates the same query and options while retaining new replacement data', () => {
    let history = addSearchHistoryEntry(createSearchHistory(), entry('cat'), 1);
    history = addSearchHistoryEntry(history, { ...entry('cat'), replacement: 'dog', caseSensitive: true }, 2);
    history = addSearchHistoryEntry(history, { ...entry('cat'), replacement: 'fox' }, 3);
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0]).toMatchObject({ replacement: 'fox', usedAt: 3 });
  });

  it('round-trips valid state through versioned JSON', () => {
    const history = addSearchHistoryEntry(createSearchHistory(4), entry('query'), 42);
    expect(parseSearchHistory(serializeSearchHistory(history))).toEqual(history);
  });

  it('sorts persisted entries and drops invalid or excess records', () => {
    const parsed = parseSearchHistory({
      version: SEARCH_HISTORY_VERSION,
      limit: 2,
      entries: [entry('old', 1), { nonsense: true }, entry('new', 3), entry('middle', 2)],
    });
    expect(parsed.entries.map((item) => item.query)).toEqual(['new', 'middle']);
  });

  it('rejects unknown versions and malformed JSON without throwing', () => {
    expect(parseSearchHistory('{bad JSON').entries).toEqual([]);
    expect(parseSearchHistory({ version: 99, entries: [entry('ignored', 1)] }).entries).toEqual([]);
  });

  it('ignores empty and oversized entries', () => {
    const history = createSearchHistory();
    expect(addSearchHistoryEntry(history, entry(''), 1)).toBe(history);
    expect(addSearchHistoryEntry(history, entry('x'.repeat(2_001)), 1)).toBe(history);
  });
});
