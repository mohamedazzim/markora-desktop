import { describe, expect, it } from 'vitest';
import {
  collectDocumentLandmarks,
  findWritingNavigationTarget,
} from '../../src/renderer/appearance/writing-navigation';

const source = [
  '# First',
  '',
  'First paragraph',
  'continues.',
  '',
  'Setext heading',
  '--------------',
  '',
  'Second paragraph.',
  '',
  '```markdown',
  '# Not a heading',
  '```',
  '',
  '## Final',
  '',
].join('\n');

describe('writing navigation landmarks', () => {
  it('finds ATX and Setext headings while skipping fenced code', () => {
    expect(
      collectDocumentLandmarks(source)
        .filter((landmark) => landmark.kind === 'heading')
        .map((heading) => [heading.line, heading.text]),
    ).toEqual([
      [1, 'First'],
      [6, 'Setext heading'],
      [15, 'Final'],
    ]);
  });

  it('finds blank-line-delimited paragraph starts', () => {
    const paragraphs = collectDocumentLandmarks(source).filter((landmark) => landmark.kind === 'paragraph');
    expect(paragraphs.map((paragraph) => paragraph.line)).toEqual([1, 3, 6, 9, 11, 15]);
  });
});

describe('writing navigation targets', () => {
  it('jumps to top, bottom, and the active selection head', () => {
    expect(findWritingNavigationTarget(source, { anchor: 8, head: 12 }, 'top')).toMatchObject({
      offset: 0,
      line: 1,
      selection: { anchor: 0, head: 0 },
    });
    expect(findWritingNavigationTarget(source, { anchor: 0, head: 0 }, 'bottom')).toMatchObject({
      offset: source.length,
    });
    expect(findWritingNavigationTarget(source, { anchor: 5, head: 12 }, 'selection')).toMatchObject({
      offset: 12,
      selection: { anchor: 12, head: 12 },
    });
  });

  it('moves to previous and next headings using canonical offsets', () => {
    const setextOffset = source.indexOf('Setext heading');
    const finalOffset = source.indexOf('## Final');
    expect(
      findWritingNavigationTarget(source, { anchor: setextOffset, head: setextOffset }, 'previous-heading'),
    ).toMatchObject({ landmark: { text: 'First', line: 1 }, offset: 0 });
    expect(
      findWritingNavigationTarget(source, { anchor: setextOffset, head: setextOffset }, 'next-heading'),
    ).toMatchObject({ landmark: { text: 'Final', line: 15 }, offset: finalOffset });
  });

  it('moves to current paragraph start before moving farther backward', () => {
    const paragraph = source.indexOf('Second paragraph.');
    const inside = paragraph + 8;
    expect(
      findWritingNavigationTarget(source, { anchor: inside, head: inside }, 'previous-paragraph'),
    ).toMatchObject({ offset: paragraph, landmark: { kind: 'paragraph', line: 9 } });
  });

  it('returns null when no landmark exists in the requested direction', () => {
    expect(findWritingNavigationTarget(source, { anchor: 0, head: 0 }, 'previous-heading')).toBeNull();
    expect(
      findWritingNavigationTarget(source, { anchor: source.length, head: source.length }, 'next-heading'),
    ).toBeNull();
  });

  it('clamps invalid selection heads and preserves UTF-16 Unicode offsets', () => {
    const unicode = '# 😀\n\nParagraph Ω';
    expect(findWritingNavigationTarget(unicode, { anchor: 0, head: 999 }, 'selection')?.offset).toBe(
      unicode.length,
    );
    const paragraph = unicode.indexOf('Paragraph');
    expect(findWritingNavigationTarget(unicode, { anchor: 0, head: 1 }, 'next-paragraph')?.offset).toBe(
      paragraph,
    );
  });
});
