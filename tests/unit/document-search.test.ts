import { describe, expect, it } from 'vitest';
import {
  createReplaceAllConfirmation,
  navigateSearchMatches,
  replaceAllSearchMatches,
  replaceSearchMatch,
  searchDocument,
  type DocumentSearchOptions,
} from '../../src/renderer/search/document-search';

const options = (overrides: Partial<DocumentSearchOptions> = {}): DocumentSearchOptions => ({
  query: 'cat',
  regularExpression: false,
  caseSensitive: false,
  wholeWord: false,
  ...overrides,
});

describe('document searching', () => {
  it('finds literal matches case-insensitively with canonical offsets', () => {
    const result = searchDocument('Cat cat scatter CAT', options());
    expect(result.matches.map(({ start, end, text }) => ({ start, end, text }))).toEqual([
      { start: 0, end: 3, text: 'Cat' },
      { start: 4, end: 7, text: 'cat' },
      { start: 9, end: 12, text: 'cat' },
      { start: 16, end: 19, text: 'CAT' },
    ]);
  });

  it('honors case sensitivity and treats regex punctuation literally', () => {
    expect(
      searchDocument('Cat cat CAT', options({ caseSensitive: true })).matches.map((match) => match.start),
    ).toEqual([4]);
    expect(searchDocument('a.b axb a.b', options({ query: 'a.b' })).matches).toHaveLength(2);
  });

  it('supports multiline regular expressions, captures, and named captures', () => {
    const result = searchDocument(
      'one=1\ntwo=22',
      options({
        query: '^(?<name>\\w+)=(\\d+)$',
        regularExpression: true,
        caseSensitive: true,
      }),
    );
    expect(result.matches).toHaveLength(2);
    expect(result.matches[1]).toMatchObject({
      text: 'two=22',
      captures: ['two', '22'],
      namedCaptures: { name: 'two' },
    });
  });

  it('returns an actionable error instead of throwing for an invalid regex', () => {
    const result = searchDocument('text', options({ query: '[', regularExpression: true }));
    expect(result.matches).toEqual([]);
    expect(result.error).toMatchObject({ code: 'invalid-regular-expression' });
    expect(result.error?.message).toMatch(/regular expression|unterminated|invalid/i);
  });

  it('supports whole-word matching with Unicode word boundaries', () => {
    const ascii = searchDocument('cat scatter cat_ cat-cat', options({ wholeWord: true }));
    expect(ascii.matches.map((match) => match.start)).toEqual([0, 17, 21]);

    const unicode = searchDocument('élan préélan élan-élan', options({ query: 'élan', wholeWord: true }));
    expect(unicode.matches.map((match) => match.start)).toEqual([0, 13, 18]);
  });

  it('limits search to a selection while retaining document offsets', () => {
    const text = 'cat outside\ncat inside\ncat outside';
    const start = text.indexOf('cat inside');
    const result = searchDocument(text, options({ selection: { start, end: start + 10 } }));
    expect(result.scope).toEqual({ start, end: start + 10 });
    expect(result.matches.map((match) => match.start)).toEqual([start]);
  });

  it('normalizes reversed selections and rejects out-of-range selections', () => {
    expect(searchDocument('cat', options({ selection: { start: 3, end: 0 } })).matches).toHaveLength(1);
    const invalid = searchDocument('cat', options({ selection: { start: 0, end: 9 } }));
    expect(invalid.error?.code).toBe('invalid-selection');
  });

  it('terminates safely for zero-width Unicode regular expressions', () => {
    const result = searchDocument(
      '😀a',
      options({ query: '(?=.)', regularExpression: true, caseSensitive: true }),
    );
    expect(result.matches.map((match) => [match.start, match.end, match.zeroWidth])).toEqual([
      [0, 0, true],
      [2, 2, true],
    ]);
  });

  it('bounds result growth and reports truncation', () => {
    const result = searchDocument('aaaaa', options({ query: 'a', maxMatches: 3 }));
    expect(result.matches).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('returns an empty, valid result for an empty query and empty document', () => {
    expect(searchDocument('', options({ query: '' }))).toEqual({
      query: '',
      matches: [],
      scope: { start: 0, end: 0 },
      truncated: false,
    });
  });
});

describe('match navigation', () => {
  const matches = searchDocument('cat cat cat', options()).matches;

  it('starts in the requested direction and moves predictably', () => {
    expect(navigateSearchMatches(matches, -1, 'next')).toMatchObject({ index: 0, wrapped: false });
    expect(navigateSearchMatches(matches, -1, 'previous')).toMatchObject({
      index: 2,
      wrapped: false,
    });
    expect(navigateSearchMatches(matches, 0, 'next')?.index).toBe(1);
  });

  it('wraps in both directions and handles no matches', () => {
    expect(navigateSearchMatches(matches, 2, 'next')).toMatchObject({ index: 0, wrapped: true });
    expect(navigateSearchMatches(matches, 0, 'previous')).toMatchObject({
      index: 2,
      wrapped: true,
    });
    expect(navigateSearchMatches([], -1, 'next')).toBeNull();
  });
});

describe('document replacement', () => {
  it('replaces one literal match without interpreting dollar tokens', () => {
    const source = 'cat cat';
    const match = searchDocument(source, options()).matches[1];
    const replacement = replaceSearchMatch(source, match, '$1', false);
    expect(replacement.text).toBe('cat $1');
    expect(replacement.insertedRanges).toEqual([{ start: 4, end: 6 }]);
  });

  it('expands numeric, named, whole-match, and escaped-dollar regex tokens', () => {
    const source = 'first:last';
    const result = searchDocument(
      source,
      options({
        query: '(?<first>\\w+):(\\w+)',
        regularExpression: true,
        caseSensitive: true,
      }),
    );
    const replacement = replaceSearchMatch(source, result.matches[0], '$2/$<first> [$&] $$', true);
    expect(replacement.text).toBe('last/first [first:last] $');
  });

  it('rejects stale match metadata', () => {
    const match = searchDocument('cat', options()).matches[0];
    expect(() => replaceSearchMatch('dog', match, 'x', false)).toThrow(/stale/);
  });

  it('replaces every match from end to start and reports final inserted ranges', () => {
    const source = 'a a a';
    const searchOptions = options({ query: 'a' });
    const result = searchDocument(source, searchOptions);
    const replacement = replaceAllSearchMatches(source, result, searchOptions, 'long');
    expect(replacement.text).toBe('long long long');
    expect(replacement.replacedCount).toBe(3);
    expect(replacement.insertedRanges).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ]);
  });

  it('applies zero-width replace-all insertions exactly once per match', () => {
    const source = 'ab';
    const searchOptions = options({ query: '^|$', regularExpression: true });
    const result = searchDocument(source, searchOptions);
    const replacement = replaceAllSearchMatches(source, result, searchOptions, '|');
    expect(result.matches).toHaveLength(2);
    expect(replacement.text).toBe('|ab|');
  });

  it('only replaces selected-scope matches', () => {
    const source = 'cat cat cat';
    const searchOptions = options({ selection: { start: 4, end: 7 } });
    const result = searchDocument(source, searchOptions);
    expect(replaceAllSearchMatches(source, result, searchOptions, 'dog').text).toBe('cat dog cat');
  });

  it('produces explicit replace-all confirmation metadata', () => {
    const source = 'cat cat';
    const searchOptions = options({ wholeWord: true });
    const result = searchDocument(source, searchOptions);
    expect(createReplaceAllConfirmation(result, searchOptions, 'dog')).toEqual({
      kind: 'replace-all',
      query: 'cat',
      replacement: 'dog',
      matchCount: 2,
      zeroWidthMatchCount: 0,
      matchedCharacterCount: 6,
      scope: { start: 0, end: 7 },
      regularExpression: false,
      caseSensitive: false,
      wholeWord: true,
      truncated: false,
    });
  });
});
