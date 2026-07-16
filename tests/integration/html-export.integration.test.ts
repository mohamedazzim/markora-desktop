import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHtmlExport, writeHtmlExport } from '../../electron/main/html-export';
import { defaultHtmlExportOptions, type HtmlExportOptions } from '../../src/shared/html-export';

let root = '';

function options(overrides: Partial<HtmlExportOptions> = {}): HtmlExportOptions {
  return { ...defaultHtmlExportOptions, ...overrides };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-html-integration-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('HTML export integration', () => {
  it('exports the production fixture with local assets, math, diagrams, code, tables, and metadata', async () => {
    const fixture = await fs.readFile(path.resolve('tests/fixtures/export/html-export.md'), 'utf8');
    const sourceDirectory = path.join(root, 'source');
    const sourcePath = path.join(sourceDirectory, 'fixture.md');
    const imagePath = path.join(sourceDirectory, 'images', 'fixture.png');
    const outputPath = path.join(root, 'output', 'fixture.html');
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(sourcePath, fixture, 'utf8');
    await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const record = await writeHtmlExport(
      outputPath,
      fixture,
      options({
        embedLocalImages: true,
        includeTableOfContents: true,
        theme: 'github-dark',
      }),
      { sourcePath, workspaceRoot: root },
    );
    const exported = await fs.readFile(outputPath, 'utf8');

    expect(record.embeddedImageCount).toBe(1);
    expect(record.headingCount).toBe(2);
    expect(record.hasMath).toBe(true);
    expect(record.hasMermaid).toBe(true);
    expect(record.warnings).toEqual([]);
    expect(exported).toContain('<title>Export fixture — नमस्ते</title>');
    expect(exported).toContain('<table>');
    expect(exported).toContain('class="hljs language-typescript"');
    expect(exported).toContain('class="katex"');
    expect(exported).toContain('<pre class="mermaid"');
    expect(exported).toContain("securityLevel:'strict'");
    expect(exported).toContain('src="data:image/png;base64,');
    expect(exported).toContain('aria-label="Table of contents"');
    expect(exported).toContain('href="#details"');
    expect(exported).not.toContain("alert('never export')");
    expect(record.byteLength).toBe(Buffer.byteLength(exported, 'utf8'));
  });

  it('overwrites an existing export without leaving temporary files', async () => {
    const outputPath = path.join(root, 'document.html');
    await writeHtmlExport(outputPath, '# First', options({ syntaxHighlighting: false }));
    await writeHtmlExport(outputPath, '# Second', options({ syntaxHighlighting: false }));
    const exported = await fs.readFile(outputPath, 'utf8');
    expect(exported).toContain('>Second</a>');
    expect(exported).not.toContain('>First</a>');
    expect((await fs.readdir(root)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('rebases local image paths when an export is written outside the source folder', async () => {
    const sourcePath = path.join(root, 'workspace', 'notes', 'note.md');
    const imagePath = path.join(root, 'workspace', 'assets', 'diagram.webp');
    const outputPath = path.join(root, 'exports', 'note.html');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(sourcePath, '![](../../assets/diagram.webp)');
    await fs.writeFile(imagePath, Buffer.from('RIFF----WEBP'));

    const result = await writeHtmlExport(
      outputPath,
      '![](../assets/diagram.webp)',
      options({ embedCss: false, syntaxHighlighting: false }),
      {
        sourcePath,
        workspaceRoot: path.join(root, 'workspace'),
      },
    );
    const exported = await fs.readFile(outputPath, 'utf8');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CSS_NOT_EMBEDDED' })]),
    );
    expect(exported).toContain('src="../workspace/assets/diagram.webp"');
  });

  it('keeps a fragment portable and script-free', async () => {
    const fixture = await fs.readFile(path.resolve('tests/fixtures/export/html-export.md'), 'utf8');
    const result = await renderHtmlExport(
      fixture,
      options({
        standalone: false,
        styling: 'unstyled',
        embedCss: false,
        renderMermaid: false,
        renderMath: false,
        syntaxHighlighting: false,
      }),
    );
    expect(result.html).toMatch(/^<article/);
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('<style');
    expect(result.html).not.toContain('<html');
    expect(result.html).toContain('<table>');
  });

  it('reports broken and unsupported assets independently while completing the export', async () => {
    const sourcePath = path.join(root, 'document.md');
    await fs.writeFile(sourcePath, '');
    await fs.writeFile(path.join(root, 'active.svg'), '<svg><script>alert(1)</script></svg>');
    const result = await renderHtmlExport(
      '![](missing.png)\n\n![](active.svg)',
      options({
        standalone: false,
        styling: 'unstyled',
        embedCss: false,
        syntaxHighlighting: false,
        embedLocalImages: true,
      }),
      { sourcePath },
    );
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['IMAGE_NOT_FOUND', 'IMAGE_UNSUPPORTED_TYPE']),
    );
    expect(result.embeddedImageCount).toBe(0);
    expect(result.html).not.toContain('<script');
  });
});
