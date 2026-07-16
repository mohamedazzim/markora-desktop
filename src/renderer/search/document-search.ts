export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface DocumentSearchOptions {
  readonly query: string;
  readonly regularExpression: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  /** When present, anchors and returned offsets are scoped to this document range. */
  readonly selection?: TextRange;
  readonly maxMatches?: number;
}

export interface DocumentSearchMatch extends TextRange {
  readonly text: string;
  readonly captures: readonly (string | undefined)[];
  readonly namedCaptures?: Readonly<Record<string, string | undefined>>;
  readonly zeroWidth: boolean;
}

export interface DocumentSearchError {
  readonly code: 'invalid-regular-expression' | 'invalid-selection';
  readonly message: string;
}

export interface DocumentSearchResult {
  readonly query: string;
  readonly matches: readonly DocumentSearchMatch[];
  readonly scope: TextRange;
  readonly truncated: boolean;
  readonly error?: DocumentSearchError;
}

export interface MatchNavigation {
  readonly index: number;
  readonly match: DocumentSearchMatch;
  readonly wrapped: boolean;
  readonly direction: 'next' | 'previous';
}

export interface ReplaceConfirmationMetadata {
  readonly kind: 'replace-all';
  readonly query: string;
  readonly replacement: string;
  readonly matchCount: number;
  readonly zeroWidthMatchCount: number;
  readonly matchedCharacterCount: number;
  readonly scope: TextRange;
  readonly regularExpression: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly truncated: boolean;
}

export interface DocumentReplacement {
  readonly text: string;
  readonly replacedCount: number;
  readonly replacedRanges: readonly TextRange[];
  readonly insertedRanges: readonly TextRange[];
  readonly confirmation?: ReplaceConfirmationMetadata;
}

const DEFAULT_MAX_MATCHES = 100_000;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}_]/u;

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedScope(text: string, selection: TextRange | undefined): TextRange | null {
  if (!selection) return { start: 0, end: text.length };
  if (
    !Number.isSafeInteger(selection.start) ||
    !Number.isSafeInteger(selection.end) ||
    selection.start < 0 ||
    selection.end < 0 ||
    selection.start > text.length ||
    selection.end > text.length
  ) {
    return null;
  }
  return {
    start: Math.min(selection.start, selection.end),
    end: Math.max(selection.start, selection.end),
  };
}

function isWholeWord(text: string, start: number, end: number): boolean {
  let beforeIndex = start - 1;
  if (
    beforeIndex > 0 &&
    text.charCodeAt(beforeIndex) >= 0xdc00 &&
    text.charCodeAt(beforeIndex) <= 0xdfff &&
    text.charCodeAt(beforeIndex - 1) >= 0xd800 &&
    text.charCodeAt(beforeIndex - 1) <= 0xdbff
  ) {
    beforeIndex -= 1;
  }
  const before = beforeIndex >= 0 ? text.codePointAt(beforeIndex) : undefined;
  const after = end < text.length ? text.codePointAt(end) : undefined;
  const beforeCharacter = before === undefined ? '' : String.fromCodePoint(before);
  const afterCharacter = after === undefined ? '' : String.fromCodePoint(after);
  return !WORD_CHARACTER.test(beforeCharacter) && !WORD_CHARACTER.test(afterCharacter);
}

function advanceStringIndex(value: string, index: number): number {
  if (index >= value.length) return index + 1;
  const first = value.charCodeAt(index);
  if (first < 0xd800 || first > 0xdbff || index + 1 >= value.length) return index + 1;
  const second = value.charCodeAt(index + 1);
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1;
}

function boundedMatchLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_MATCHES;
  if (!Number.isSafeInteger(value) || value < 1) return DEFAULT_MAX_MATCHES;
  return Math.min(value, DEFAULT_MAX_MATCHES);
}

/** Finds canonical UTF-16 document ranges without mutating editor state. */
export function searchDocument(text: string, options: DocumentSearchOptions): DocumentSearchResult {
  const scope = normalizedScope(text, options.selection);
  if (!scope) {
    return {
      query: options.query,
      matches: [],
      scope: { start: 0, end: text.length },
      truncated: false,
      error: {
        code: 'invalid-selection',
        message: 'The search selection is outside the current document.',
      },
    };
  }
  if (!options.query) {
    return { query: options.query, matches: [], scope, truncated: false };
  }

  let expression: RegExp;
  try {
    expression = new RegExp(
      options.regularExpression ? options.query : escapeRegularExpression(options.query),
      `gmu${options.caseSensitive ? '' : 'i'}`,
    );
  } catch (cause) {
    return {
      query: options.query,
      matches: [],
      scope,
      truncated: false,
      error: {
        code: 'invalid-regular-expression',
        message: cause instanceof Error ? cause.message : 'The regular expression is invalid.',
      },
    };
  }

  const scopedText = text.slice(scope.start, scope.end);
  const matches: DocumentSearchMatch[] = [];
  const limit = boundedMatchLimit(options.maxMatches);
  let truncated = false;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(scopedText)) !== null) {
    const localStart = match.index;
    const localEnd = localStart + match[0].length;
    if (!options.wholeWord || isWholeWord(text, scope.start + localStart, scope.start + localEnd)) {
      if (matches.length === limit) {
        truncated = true;
        break;
      }
      matches.push({
        start: scope.start + localStart,
        end: scope.start + localEnd,
        text: match[0],
        captures: match.slice(1),
        namedCaptures: match.groups ? { ...match.groups } : undefined,
        zeroWidth: match[0].length === 0,
      });
    }
    if (match[0].length === 0) expression.lastIndex = advanceStringIndex(scopedText, expression.lastIndex);
  }

  return { query: options.query, matches, scope, truncated };
}

export function navigateSearchMatches(
  matches: readonly DocumentSearchMatch[],
  currentIndex: number,
  direction: 'next' | 'previous',
): MatchNavigation | null {
  if (matches.length === 0) return null;
  const validCurrent =
    Number.isSafeInteger(currentIndex) && currentIndex >= 0 && currentIndex < matches.length;
  let index: number;
  let wrapped = false;
  if (!validCurrent) {
    index = direction === 'next' ? 0 : matches.length - 1;
  } else if (direction === 'next') {
    index = currentIndex + 1;
    if (index === matches.length) {
      index = 0;
      wrapped = true;
    }
  } else {
    index = currentIndex - 1;
    if (index < 0) {
      index = matches.length - 1;
      wrapped = true;
    }
  }
  return { index, match: matches[index], wrapped, direction };
}

function expandRegularExpressionReplacement(
  replacement: string,
  match: DocumentSearchMatch,
  source: string,
): string {
  return replacement.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>)/g, (token, key: string) => {
    if (key === '$') return '$';
    if (key === '&') return match.text;
    if (key === '`') return source.slice(0, match.start);
    if (key === "'") return source.slice(match.end);
    if (key.startsWith('<')) {
      if (!match.namedCaptures) return token;
      return match.namedCaptures[key.slice(1, -1)] ?? '';
    }
    const captureIndex = Number(key);
    if (captureIndex > 0 && captureIndex <= match.captures.length) {
      return match.captures[captureIndex - 1] ?? '';
    }
    if (key.length === 2) {
      const firstDigit = Number(key[0]);
      if (firstDigit > 0 && firstDigit <= match.captures.length) {
        return `${match.captures[firstDigit - 1] ?? ''}${key[1]}`;
      }
    }
    return token;
  });
}

function replacementForMatch(
  source: string,
  match: DocumentSearchMatch,
  replacement: string,
  regularExpression: boolean,
): string {
  return regularExpression ? expandRegularExpressionReplacement(replacement, match, source) : replacement;
}

function validateMatch(source: string, match: DocumentSearchMatch): void {
  if (
    !Number.isSafeInteger(match.start) ||
    !Number.isSafeInteger(match.end) ||
    match.start < 0 ||
    match.end < match.start ||
    match.end > source.length ||
    source.slice(match.start, match.end) !== match.text
  ) {
    throw new RangeError('The search match is stale or outside the current document.');
  }
}

export function replaceSearchMatch(
  source: string,
  match: DocumentSearchMatch,
  replacement: string,
  regularExpression: boolean,
): DocumentReplacement {
  validateMatch(source, match);
  const inserted = replacementForMatch(source, match, replacement, regularExpression);
  return {
    text: `${source.slice(0, match.start)}${inserted}${source.slice(match.end)}`,
    replacedCount: 1,
    replacedRanges: [{ start: match.start, end: match.end }],
    insertedRanges: [{ start: match.start, end: match.start + inserted.length }],
  };
}

export function createReplaceAllConfirmation(
  result: DocumentSearchResult,
  options: DocumentSearchOptions,
  replacement: string,
): ReplaceConfirmationMetadata {
  return {
    kind: 'replace-all',
    query: result.query,
    replacement,
    matchCount: result.matches.length,
    zeroWidthMatchCount: result.matches.filter((match) => match.zeroWidth).length,
    matchedCharacterCount: result.matches.reduce((total, match) => total + match.text.length, 0),
    scope: result.scope,
    regularExpression: options.regularExpression,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    truncated: result.truncated,
  };
}

/** Applies a previously previewed, non-overlapping result set from end to start. */
export function replaceAllSearchMatches(
  source: string,
  result: DocumentSearchResult,
  options: DocumentSearchOptions,
  replacement: string,
): DocumentReplacement {
  if (result.error) throw new TypeError('Cannot replace matches from an invalid search.');
  for (const match of result.matches) validateMatch(source, match);

  let text = source;
  const insertedByMatch = result.matches.map((match) =>
    replacementForMatch(source, match, replacement, options.regularExpression),
  );
  const insertedRanges: TextRange[] = [];
  let offsetDelta = 0;
  for (let index = 0; index < result.matches.length; index += 1) {
    const match = result.matches[index];
    const inserted = insertedByMatch[index];
    const start = match.start + offsetDelta;
    insertedRanges.push({ start, end: start + inserted.length });
    offsetDelta += inserted.length - match.text.length;
  }
  const replacedRanges = result.matches.map(({ start, end }) => ({ start, end }));
  for (let index = result.matches.length - 1; index >= 0; index -= 1) {
    const match = result.matches[index];
    const inserted = insertedByMatch[index];
    text = `${text.slice(0, match.start)}${inserted}${text.slice(match.end)}`;
  }
  return {
    text,
    replacedCount: result.matches.length,
    replacedRanges,
    insertedRanges,
    confirmation: createReplaceAllConfirmation(result, options, replacement),
  };
}
