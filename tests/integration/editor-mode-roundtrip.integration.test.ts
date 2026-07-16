// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { CanonicalDocument } from '../../src/renderer/documents/canonical-document';
import * as transform from '../../src/renderer/markdown/transform';

const withoutPositions = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutPositions);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'position')
      .map(([key, child]) => [key, withoutPositions(child)]),
  );
};

const semanticTree = (source: string) => withoutPositions(transform.parseMarkdown(source));

const baseDocument = [
  '---',
  'title: Synchronization journey',
  'author: Markora',
  '---',
  '',
  '# Canonical document',
  '',
  'Original paragraph with **bold** and [a link](https://example.test).',
  '',
  '```ts',
  'const greeting = "hello";',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '$$',
  'x^2 + y^2 = z^2',
  '$$',
  '',
].join('\n');

describe('source/structured canonical editing integration', () => {
  it('completes source edit → structured edit → source → save → reopen with stable semantics', () => {
    const document = CanonicalDocument.fromDisk(baseDocument.replace(/\n/g, '\r\n'));

    // Source Mode changes the sole canonical text, not a private editor copy.
    document.setText(
      document.text.replace('Original paragraph', 'Source edit: Café 文档 العربية 📝.\n\nOriginal paragraph'),
    );
    document.setViewSnapshot('source', {
      anchor: document.text.indexOf('Café'),
      head: document.text.indexOf('Café') + 'Café'.length,
      scrollTop: 240,
      scrollLeft: 0,
    });

    const structuredHtml = transform.markdownToStructuredHtml(document.text);
    expect(structuredHtml).toContain('Source edit: Café 文档 العربية 📝.');
    expect(structuredHtml).toContain('data-markora-fence="frontmatter"');
    expect(structuredHtml).toContain('data-markora-fence="mermaid"');

    // This is the form a Tiptap transaction supplies to the canonical model.
    const afterStructuredEdit = transform.structuredHtmlToMarkdown(
      `${structuredHtml}<p>Structured edit with <strong>bold</strong> and <em>emphasis</em>.</p>`,
    );
    document.setText(afterStructuredEdit);
    document.setViewSnapshot('structured', {
      anchor: 3,
      head: 3,
      scrollTop: 96,
      scrollLeft: 0,
    });

    expect(document.text).toContain('Source edit: Café 文档 العربية 📝.');
    expect(document.text).toContain('Structured edit with **bold** and _emphasis_.');
    expect(document.lineEnding).toBe('crlf');
    expect(document.dirty).toBe(true);

    const save = document.beginSave();
    expect(save.diskText).not.toMatch(/(^|[^\r])\n/);
    document.completeSave(save);
    const reopened = CanonicalDocument.fromDisk(save.diskText);

    expect(reopened.text).toBe(document.text);
    expect(reopened.lineEnding).toBe('crlf');
    expect(reopened.dirty).toBe(false);
    expect(reopened.text).toContain('```mermaid\ngraph TD\n  A --> B\n```');
    expect(reopened.text).toContain('$$\nx^2 + y^2 = z^2\n$$');

    const onceMore = transform.structuredHtmlToMarkdown(transform.markdownToStructuredHtml(reopened.text));
    expect(semanticTree(onceMore)).toEqual(semanticTree(reopened.text));
    expect(transform.structuredHtmlToMarkdown(transform.markdownToStructuredHtml(onceMore))).toBe(onceMore);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('keeps %s a disk concern while both editor modes exchange canonical LF', (_name, ending) => {
    const diskText = ['# Line endings', '', 'First', 'Second', ''].join(ending);
    const document = CanonicalDocument.fromDisk(diskText);
    const structured = transform.markdownToStructuredHtml(document.text);
    document.setText(transform.structuredHtmlToMarkdown(structured));

    expect(document.text).not.toContain('\r');
    const save = document.beginSave();
    if (ending === '\r\n') expect(save.diskText).toContain('\r\n');
    else expect(save.diskText).not.toContain('\r');
  });

  it('does not invent content when an empty document visits Structured Mode', () => {
    const document = CanonicalDocument.createNew();
    document.setText(transform.structuredHtmlToMarkdown(transform.markdownToStructuredHtml(document.text)));

    expect(document.text).toBe('');
    expect(document.dirty).toBe(false);
  });

  it('preserves multilingual text through both conversions and a save/reopen', () => {
    const source = '# Unicode\n\nCafé · 文档 · العربية · 📝 · 👩🏽‍💻 · 日本語 · 한국어\n';
    const document = CanonicalDocument.fromDisk(source);
    const structured = transform.markdownToStructuredHtml(document.text);
    document.setText(transform.structuredHtmlToMarkdown(structured));
    const save = document.beginSave();
    document.completeSave(save);
    const reopened = CanonicalDocument.fromDisk(save.diskText);

    for (const value of ['Café', '文档', 'العربية', '📝', '👩🏽‍💻', '日本語', '한국어']) {
      expect(reopened.text).toContain(value);
    }
    expect(semanticTree(reopened.text)).toEqual(semanticTree(source));
  });

  it('round-trips a realistic large structured document without truncating its tail', () => {
    const paragraphs = Array.from(
      { length: 2_000 },
      (_, index) =>
        `## Section ${index + 1}\n\nParagraph ${index + 1} contains **bold**, Unicode 文档, and [link](https://example.test/${index + 1}).`,
    );
    const source = `# Large document\n\n${paragraphs.join('\n\n')}\n`;
    const document = CanonicalDocument.fromDisk(source);

    const structured = transform.markdownToStructuredHtml(document.text);
    document.setText(transform.structuredHtmlToMarkdown(structured));

    expect(document.text).toContain('## Section 1\n');
    expect(document.text).toContain('## Section 2000\n');
    expect(document.text).toContain('https://example.test/2000');
    expect(document.text).toContain('Unicode 文档');
    expect(document.text.length).toBeGreaterThan(200_000);
  }, 30_000);
});
