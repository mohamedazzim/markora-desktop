export type WritingNavigationCommand =
  | 'top'
  | 'bottom'
  | 'selection'
  | 'previous-heading'
  | 'next-heading'
  | 'previous-paragraph'
  | 'next-paragraph';

export interface EditorNavigationSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface DocumentLandmark {
  readonly kind: 'heading' | 'paragraph';
  readonly offset: number;
  readonly line: number;
  readonly text: string;
}

export interface WritingNavigationTarget {
  readonly command: WritingNavigationCommand;
  readonly offset: number;
  readonly line: number;
  readonly selection: EditorNavigationSelection;
  readonly landmark?: DocumentLandmark;
}

interface SourceLine {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start <= source.length) {
    const newline = source.indexOf('\n', start);
    const end = newline === -1 ? source.length : newline;
    lines.push({ start, end, text: source.slice(start, end).replace(/\r$/, '') });
    if (newline === -1) break;
    start = newline + 1;
  }
  return lines;
}

function lineForOffset(lines: readonly SourceLine[], offset: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].start <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high) + 1;
}

function collectHeadings(lines: readonly SourceLine[]): DocumentLandmark[] {
  const headings: DocumentLandmark[] = [];
  let fenceCharacter = '';
  let fenceLength = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence) {
      const character = fence[1][0];
      if (!fenceCharacter) {
        fenceCharacter = character;
        fenceLength = fence[1].length;
      } else if (character === fenceCharacter && fence[1].length >= fenceLength) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter) continue;

    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.+?)\s*#*\s*$|[ \t]*$)/.exec(line.text);
    if (atx) {
      headings.push({
        kind: 'heading',
        offset: line.start,
        line: index + 1,
        text: atx[2]?.trim() ?? '',
      });
      continue;
    }
    const next = lines[index + 1];
    if (line.text.trim() && next && /^ {0,3}(?:=+|-+)\s*$/.test(next.text)) {
      headings.push({
        kind: 'heading',
        offset: line.start,
        line: index + 1,
        text: line.text.trim(),
      });
      index += 1;
    }
  }
  return headings;
}

function collectParagraphs(lines: readonly SourceLine[]): DocumentLandmark[] {
  const paragraphs: DocumentLandmark[] = [];
  let previousBlank = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const blank = line.text.trim().length === 0;
    if (!blank && previousBlank) {
      paragraphs.push({
        kind: 'paragraph',
        offset: line.start,
        line: index + 1,
        text: line.text.trim(),
      });
    }
    previousBlank = blank;
  }
  return paragraphs;
}

export function collectDocumentLandmarks(source: string): readonly DocumentLandmark[] {
  const lines = sourceLines(source);
  return [...collectHeadings(lines), ...collectParagraphs(lines)].sort(
    (left, right) => left.offset - right.offset || left.kind.localeCompare(right.kind),
  );
}

function target(
  source: string,
  lines: readonly SourceLine[],
  command: WritingNavigationCommand,
  offset: number,
  landmark?: DocumentLandmark,
): WritingNavigationTarget {
  const safeOffset = Math.min(source.length, Math.max(0, offset));
  return {
    command,
    offset: safeOffset,
    line: lineForOffset(lines, safeOffset),
    selection: { anchor: safeOffset, head: safeOffset },
    landmark,
  };
}

/** Resolves editor-independent navigation commands to canonical source offsets. */
export function findWritingNavigationTarget(
  source: string,
  selection: EditorNavigationSelection,
  command: WritingNavigationCommand,
): WritingNavigationTarget | null {
  const lines = sourceLines(source);
  const current = Math.min(
    source.length,
    Math.max(0, Number.isFinite(selection.head) ? Math.trunc(selection.head) : 0),
  );
  if (command === 'top') return target(source, lines, command, 0);
  if (command === 'bottom') return target(source, lines, command, source.length);
  if (command === 'selection') return target(source, lines, command, current);

  const kind = command.endsWith('heading') ? 'heading' : 'paragraph';
  const landmarks = (kind === 'heading' ? collectHeadings(lines) : collectParagraphs(lines)).filter(
    (landmark) => landmark.kind === kind,
  );
  const landmark = command.startsWith('previous')
    ? [...landmarks].reverse().find((candidate) => candidate.offset < current)
    : landmarks.find((candidate) => candidate.offset > current);
  return landmark ? target(source, lines, command, landmark.offset, landmark) : null;
}
