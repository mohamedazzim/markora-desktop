import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  markdownToStructuredHtml,
  parseMarkdown,
  structuredHtmlToMarkdown,
} from '../../src/renderer/markdown/transform';

interface AstNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  lang?: string | null;
  checked?: boolean | null;
  align?: Array<'left' | 'right' | 'center' | null>;
  children?: AstNode[];
}

const fixtureDirectory = path.join(process.cwd(), 'tests', 'fixtures', 'markdown');
const fixture = (name: string) => fs.readFileSync(path.join(fixtureDirectory, name), 'utf8');

const walk = (source: string): AstNode[] => {
  const result: AstNode[] = [];
  const visit = (node: AstNode) => {
    result.push(node);
    node.children?.forEach(visit);
  };
  visit(parseMarkdown(source) as AstNode);
  return result;
};

const nodesOfType = (source: string, type: string) => walk(source).filter((node) => node.type === type);

const nodeText = (node: AstNode): string => node.value ?? node.children?.map(nodeText).join('') ?? '';

const decodedUrl = (url: string | undefined): string => {
  if (!url) return '';
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
};

const tableSnapshot = (source: string) =>
  nodesOfType(source, 'table').map((table) => ({
    align: table.align ?? [],
    rows: table.children?.map((row) => row.children?.map(nodeText) ?? []) ?? [],
  }));

const imageSnapshot = (source: string) =>
  nodesOfType(source, 'image').map((image) => ({
    alt: image.alt ?? null,
    title: image.title ?? null,
    url: decodedUrl(image.url),
  }));

const resolvedLinkSnapshot = (source: string) => {
  const nodes = walk(source);
  const definitions = new Map(
    nodes
      .filter((node) => node.type === 'definition' && node.identifier)
      .map((node) => [node.identifier!, node]),
  );

  return nodes
    .flatMap((node) => {
      if (node.type === 'link') {
        return [{ text: nodeText(node), url: node.url ?? '', title: node.title ?? null }];
      }
      if (node.type === 'linkReference' && node.identifier) {
        const definition = definitions.get(node.identifier);
        return definition
          ? [
              {
                text: nodeText(node),
                url: definition.url ?? '',
                title: definition.title ?? null,
              },
            ]
          : [];
      }
      return [];
    })
    .sort((left, right) => left.text.localeCompare(right.text));
};

/**
 * Models the canonical synchronization path without depending on either editor UI:
 * source edit -> Structured Mode -> structured edit -> Source Mode -> save -> reopen.
 */
const completeEditingJourney = (source: string) => {
  const sourceEdited = `${source.replace(/\s*$/, '')}\n\nSource edit marker: Ω.\n`;
  const structured = markdownToStructuredHtml(sourceEdited);
  const structuredEdited = `${structured}\n<p>Structured edit marker with <strong>bold</strong> and <a href="https://example.test/edit">a link</a>.</p>`;
  const sourceMode = structuredHtmlToMarkdown(structuredEdited);
  const saved = sourceMode;
  const reopened = saved;

  return { sourceEdited, structured, structuredEdited, sourceMode, saved, reopened };
};

describe('Source and Structured Mode semantic editing journey', () => {
  it.each([
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
  ])('%s retains edits through save and reopen', (name) => {
    const result = completeEditingJourney(fixture(name));
    const reopenedText = walk(result.reopened).map(nodeText).join('\n');

    expect(result.sourceEdited).toContain('Source edit marker: Ω.');
    expect(result.structuredEdited).toContain('Structured edit marker');
    expect(reopenedText).toContain('Source edit marker: Ω.');
    expect(reopenedText).toContain('Structured edit marker with bold and a link.');
    expect(resolvedLinkSnapshot(result.reopened)).toContainEqual({
      text: 'a link',
      url: 'https://example.test/edit',
      title: null,
    });
  });

  it('preserves headings, nested lists, and task completion state', () => {
    const headingResult = completeEditingJourney(fixture('headings.md'));
    const listResult = completeEditingJourney(fixture('nested-task-lists.md'));

    expect(
      nodesOfType(headingResult.reopened, 'heading').map((node) => ({
        depth: (node as AstNode & { depth?: number }).depth,
        text: nodeText(node),
      })),
    ).toEqual(
      nodesOfType(headingResult.sourceEdited, 'heading').map((node) => ({
        depth: (node as AstNode & { depth?: number }).depth,
        text: nodeText(node),
      })),
    );
    expect(
      nodesOfType(listResult.reopened, 'listItem')
        .map((node) => node.checked)
        .filter((checked) => typeof checked === 'boolean'),
    ).toEqual([true, false]);
    expect(nodesOfType(listResult.reopened, 'list').length).toBe(
      nodesOfType(listResult.sourceEdited, 'list').length,
    );
  });

  it('preserves escaped table-cell pipes and column alignment', () => {
    const result = completeEditingJourney(fixture('escaped-pipe-table.md'));

    expect(tableSnapshot(result.reopened)).toEqual(tableSnapshot(result.sourceEdited));
  });

  it('preserves code languages, code values, and inline code', () => {
    const result = completeEditingJourney(fixture('code-fences.md'));
    const codeSnapshot = (source: string) =>
      walk(source)
        .filter((node) => node.type === 'code' || node.type === 'inlineCode')
        .map((node) => ({ type: node.type, lang: node.lang ?? null, value: node.value }));

    expect(codeSnapshot(result.reopened)).toEqual(codeSnapshot(result.sourceEdited));
  });

  it('preserves reference-link targets and footnote semantics', () => {
    const result = completeEditingJourney(fixture('references-footnotes.md'));

    expect(result.reopened).not.toContain('MARKORA_FENCE_');
    expect(resolvedLinkSnapshot(result.reopened).filter((link) => link.text !== 'a link')).toEqual(
      resolvedLinkSnapshot(result.sourceEdited),
    );
    expect(nodesOfType(result.reopened, 'footnoteReference').map((node) => node.identifier)).toEqual([
      'details',
    ]);
    expect(
      nodesOfType(result.reopened, 'footnoteDefinition').map((node) => ({
        identifier: node.identifier,
        text: nodeText(node),
      })),
    ).toEqual([
      {
        identifier: 'details',
        text: 'Footnote text with emphasis and a link.A continuation paragraph in the footnote.',
      },
    ]);
  });

  it('preserves front matter, inline/display math, and fenced math/Mermaid blocks', () => {
    const result = completeEditingJourney(fixture('frontmatter-math-mermaid.md'));
    const valueSnapshot = (source: string, type: string) =>
      nodesOfType(source, type).map((node) => node.value);
    const fencedSnapshot = (source: string) =>
      nodesOfType(source, 'code')
        .filter((node) => node.lang === 'math' || node.lang === 'mermaid')
        .map((node) => ({ lang: node.lang, value: node.value }));

    expect(valueSnapshot(result.reopened, 'yaml')).toEqual(valueSnapshot(result.sourceEdited, 'yaml'));
    expect(valueSnapshot(result.reopened, 'inlineMath')).toEqual(
      valueSnapshot(result.sourceEdited, 'inlineMath'),
    );
    expect(valueSnapshot(result.reopened, 'math')).toEqual(valueSnapshot(result.sourceEdited, 'math'));
    expect(fencedSnapshot(result.reopened)).toEqual(fencedSnapshot(result.sourceEdited));
  });

  it('preserves Markdown images, raw HTML, and HTML image dimensions', () => {
    const result = completeEditingJourney(fixture('images-raw-html.md'));
    const sourceImages = imageSnapshot(result.sourceEdited);
    const reopenedImages = imageSnapshot(result.reopened);

    expect(reopenedImages.slice(0, sourceImages.length)).toEqual(sourceImages);
    expect(result.reopened).toContain('<details open>');
    expect(result.reopened).toContain('data-note="safe"');
    expect(result.reopened).toMatch(/width=(?:"640"|640)/);
    expect(result.reopened).toMatch(/height=(?:"480"|480)/);
  });

  it('preserves Unicode and treats CRLF/LF as serialization details', () => {
    const unicodeResult = completeEditingJourney(fixture('unicode.md'));
    const lf = fixture('line-endings-lf.md').replace(/\r\n/g, '\n');
    const crlfResult = completeEditingJourney(lf.replace(/\n/g, '\r\n'));
    const lfResult = completeEditingJourney(lf);

    for (const value of ['Café', '文档', 'العربية', '📝', '👩🏽‍💻', '日本語', '한국어']) {
      expect(unicodeResult.reopened).toContain(value);
    }
    expect(tableSnapshot(crlfResult.reopened)).toEqual(tableSnapshot(lfResult.reopened));
    expect(walk(crlfResult.reopened).map(nodeText)).toEqual(walk(lfResult.reopened).map(nodeText));
  });

  it('round-trips an empty document without inventing semantic nodes', () => {
    const source = fixture('empty.md');
    const reopened = structuredHtmlToMarkdown(markdownToStructuredHtml(source));

    expect(walk(reopened).filter((node) => node.type !== 'root')).toEqual([]);
  });
});
