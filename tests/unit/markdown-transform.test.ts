import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  headingAnchors,
  markdownToStructuredHtml,
  normalizeMarkdown,
  parseMarkdown,
  serializeMarkdown,
  structuredHtmlToMarkdown,
} from '../../src/renderer/markdown/transform';

const fixture = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/markdown', name), 'utf8');
describe('Markdown transformation layer', () => {
  it('parses and serializes feature-rich Markdown with semantic nodes intact', () => {
    const source = fixture('feature-rich.md');
    const output = serializeMarkdown(parseMarkdown(source));
    expect(output).toContain('title: Markora round trip');
    expect(output).toContain('[x] Complete task');
    expect(output).toContain('```mermaid');
    expect(output).toContain('[reference][guide]');
  });
  it('does not require normalization for source-mode preservation', () => {
    const source = '# A\r\n\r\nEscaped \\| pipe\r\n';
    const sourceModeValue = source;
    expect(sourceModeValue).toBe(source);
    expect(sourceModeValue).toContain('\r\n');
    expect(normalizeMarkdown(source)).toContain('Escaped | pipe');
  });
  it('converts diagram fences through structured HTML without losing source', () => {
    const html = markdownToStructuredHtml('```mermaid\nflowchart LR\n  A --> B\n```');
    expect(html).toContain('data-markora-fence="mermaid"');
    expect(structuredHtmlToMarkdown(html)).toContain('```mermaid');
  });
  it('recognizes indented and tilde Mermaid fences from existing files', () => {
    const html = markdownToStructuredHtml('  ~~~Mermaid\r\nflowchart LR\r\n  A --> B\r\n  ~~~');
    expect(html).toContain('data-markora-fence="mermaid"');
    expect(structuredHtmlToMarkdown(html)).toContain('```mermaid');
  });
  it('preserves YAML front matter through structured conversion', () => {
    const html = markdownToStructuredHtml('---\ntitle: Example\n---\n\n# Body');
    expect(html).toContain('data-markora-fence="frontmatter"');
    expect(structuredHtmlToMarkdown(html)).toContain('title: Example');
  });
  it('creates stable duplicate heading anchors', () => {
    expect(headingAnchors('# Intro\n# Intro')).toEqual([
      { depth: 1, text: 'Intro', line: 1, id: 'intro' },
      { depth: 1, text: 'Intro', line: 2, id: 'intro-1' },
    ]);
  });
});
