import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  headingAnchors,
  normalizeMarkdown,
  parseMarkdown,
  serializeMarkdown,
} from '../../src/renderer/markdown/transform';

const fixtureDirectory = path.join(process.cwd(), 'tests', 'fixtures', 'markdown');
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDirectory, name), 'utf8');

const fixtures = [
  'headings.md',
  'nested-task-lists.md',
  'escaped-pipe-table.md',
  'code-fences.md',
  'references-footnotes.md',
  'frontmatter-math-mermaid.md',
  'images-raw-html.md',
  'unicode.md',
  'line-endings-lf.md',
  'empty.md',
] as const;

/** Positions are source-format details; the remaining tree is the document semantics. */
const semanticTree = (source: string): unknown =>
  JSON.parse(JSON.stringify(parseMarkdown(source), (key, value) => (key === 'position' ? undefined : value)));

describe('Markdown parser and serializer fixture round trips', () => {
  it.each(fixtures)('%s keeps the same semantic AST after serialization', (name) => {
    const source = fixture(name);
    const serialized = serializeMarkdown(parseMarkdown(source));

    expect(semanticTree(serialized)).toEqual(semanticTree(source));
  });

  it.each(fixtures)('%s reaches a stable canonical serialization', (name) => {
    const once = normalizeMarkdown(fixture(name));
    const twice = normalizeMarkdown(once);

    expect(twice).toBe(once);
  });

  it('treats LF and CRLF input as the same document semantics', () => {
    const lf = fixture('line-endings-lf.md').replace(/\r\n/g, '\n');
    const crlf = lf.replace(/\n/g, '\r\n');

    expect(crlf).toContain('\r\n');
    expect(semanticTree(crlf)).toEqual(semanticTree(lf));
    expect(semanticTree(normalizeMarkdown(crlf))).toEqual(semanticTree(lf));
  });

  it('normalizes line endings only when canonical serialization is requested', () => {
    const original = fixture('line-endings-lf.md').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    const sourceModeValue = original;
    const normalized = normalizeMarkdown(original);

    expect(sourceModeValue).toBe(original);
    expect(sourceModeValue).toContain('\r\n');
    expect(normalized).not.toContain('\r');
  });

  it('generates anchors for ATX and Setext headings with stable duplicates', () => {
    const anchors = headingAnchors(fixture('headings.md'));

    expect(anchors.map(({ depth, id }) => ({ depth, id }))).toEqual([
      { depth: 1, id: 'introduction' },
      { depth: 2, id: 'unicode-café-文档' },
      { depth: 1, id: 'introduction-1' },
      { depth: 3, id: 'inline-emphasis-and-code' },
      { depth: 1, id: 'setext-heading' },
    ]);
  });
});
