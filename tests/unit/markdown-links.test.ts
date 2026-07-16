import { describe, expect, it } from 'vitest';
import { normalizeMarkdownFragment, resolveMarkdownLink } from '../../src/renderer/documents/markdown-links';

const documentPath = 'C:\\workspace\\docs\\README.md';

describe('Markdown link resolution', () => {
  it.each([
    ['https://example.com', { kind: 'external', url: 'https://example.com' }],
    ['mailto:example@example.com', { kind: 'external', url: 'mailto:example@example.com' }],
  ])('keeps safe external links external: %s', (href, expected) => {
    expect(resolveMarkdownLink(href, documentPath)).toEqual(expected);
  });

  it('resolves same-document heading anchors and decodes them', () => {
    expect(resolveMarkdownLink('#High%20Level%20Application%20Architecture', documentPath)).toEqual({
      kind: 'anchor',
      fragment: 'high-level-application-architecture',
    });
  });

  it.each([
    ['ARCHITECTURE_DIAGRAMS.md', 'C:\\workspace\\docs\\ARCHITECTURE_DIAGRAMS.md'],
    [
      'Documentation/ARCHITECTURE_DIAGRAMS.md',
      'C:\\workspace\\docs\\Documentation\\ARCHITECTURE_DIAGRAMS.md',
    ],
    ['../ARCHITECTURE_DIAGRAMS.md', 'C:\\workspace\\ARCHITECTURE_DIAGRAMS.md'],
    ['My%20Document.md', 'C:\\workspace\\docs\\My Document.md'],
    ['ஆவணம்.md', 'C:\\workspace\\docs\\ஆவணம்.md'],
  ])('resolves local path %s', (href, expectedPath) => {
    expect(resolveMarkdownLink(href, documentPath)).toEqual({ kind: 'document', path: expectedPath });
  });

  it('resolves an encoded file URI and document heading', () => {
    expect(
      resolveMarkdownLink(
        'file:///C:/workspace/docs/ARCHITECTURE_DIAGRAMS.md#Dataset%20Split%20Methodology',
        documentPath,
      ),
    ).toEqual({
      kind: 'document',
      path: 'C:\\workspace\\docs\\ARCHITECTURE_DIAGRAMS.md',
      fragment: 'dataset-split-methodology',
    });
  });

  it('rejects executable protocols and reports unsaved relative documents', () => {
    expect(resolveMarkdownLink('javascript:alert(1)', documentPath).kind).toBe('invalid');
    expect(resolveMarkdownLink('other.md', '').kind).toBe('invalid');
  });

  it('normalizes fragments with the same punctuation rules as heading anchors', () => {
    expect(normalizeMarkdownFragment('## Hello, World!')).toBe('hello-world');
  });
});
