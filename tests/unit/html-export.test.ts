import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { htmlExportRuntimePaths, renderHtmlExport, writeHtmlExport } from '../../electron/main/html-export';
import { defaultHtmlExportOptions, type HtmlExportOptions } from '../../src/shared/html-export';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-html-export-'));
  temporaryDirectories.push(directory);
  return directory;
}

function options(overrides: Partial<HtmlExportOptions> = {}): HtmlExportOptions {
  return { ...defaultHtmlExportOptions, ...overrides };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('HTML export rendering', () => {
  it('creates a UTF-8 standalone document with front-matter metadata', async () => {
    const markdown =
      '\uFEFF---\ntitle: "Résumé — 東京"\nauthor: Zoë\nlanguage: fr-FR\n---\n\n# Bonjour\n\nनमस्ते';
    const result = await renderHtmlExport(markdown, options({ syntaxHighlighting: false }));

    expect(result.html).toMatch(/^<!doctype html>/);
    expect(result.html).toContain('<html lang="fr-FR">');
    expect(result.html).toContain('<title>Résumé — 東京</title>');
    expect(result.html).toContain('<meta name="author" content="Zoë">');
    expect(result.html).toContain('नमस्ते');
    expect(result.html).not.toContain('author: Zoë');
  });

  it('uses explicit metadata in preference to front matter', async () => {
    const result = await renderHtmlExport(
      '---\ntitle: Old\nauthor: One\n---\n# Heading',
      options({
        metadata: { title: 'New', author: 'Two', description: 'Safe & sound' },
        syntaxHighlighting: false,
      }),
    );
    expect(result.html).toContain('<title>New</title>');
    expect(result.html).toContain('content="Two"');
    expect(result.html).toContain('content="Safe &amp; sound"');
  });

  it('creates a reusable fragment when standalone export is disabled', async () => {
    const result = await renderHtmlExport(
      '# Fragment',
      options({ standalone: false, styling: 'unstyled', embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.html).toBe(
      '<article class="markora-document"><h1 id="fragment"><a class="heading-anchor" href="#fragment">Fragment</a></h1>\n</article>',
    );
    expect(result.html).not.toContain('<html');
  });

  it('embeds theme CSS for styled output', async () => {
    const result = await renderHtmlExport(
      '# Dark',
      options({ standalone: false, theme: 'markora-dark', syntaxHighlighting: false }),
    );
    expect(result.html).toContain('<style>');
    expect(result.html).toContain('color-scheme:dark');
    expect(result.html).toContain('--mk-bg:#111827');
  });

  it('produces unstyled output without Markora layout CSS', async () => {
    const result = await renderHtmlExport(
      'Text',
      options({ standalone: false, styling: 'unstyled', embedCss: true, syntaxHighlighting: false }),
    );
    expect(result.html).not.toContain('<style>');
    expect(result.html).toContain('<p>Text</p>');
  });

  it('warns when styled CSS embedding is disabled', async () => {
    const result = await renderHtmlExport('Text', options({ embedCss: false, syntaxHighlighting: false }));
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CSS_NOT_EMBEDDED' })]),
    );
    expect(result.html).not.toContain('<style>');
  });

  it('adds stable Unicode and duplicate heading anchors plus a table of contents', async () => {
    const result = await renderHtmlExport(
      '# Café\n\n## Café\n\n## 東京\n',
      options({
        includeTableOfContents: true,
        standalone: false,
        embedCss: false,
        syntaxHighlighting: false,
      }),
    );
    expect(result.headingCount).toBe(3);
    expect(result.html).toContain('aria-label="Table of contents"');
    expect(result.html).toContain('href="#café"');
    expect(result.html).toContain('id="café-1"');
    expect(result.html).toContain('id="東京"');
  });

  it('preserves internal heading links', async () => {
    const result = await renderHtmlExport(
      '[Go](#target)\n\n## Target',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.html).toContain('<a href="#target">Go</a>');
    expect(result.html).toContain('id="target"');
  });

  it('sanitizes raw HTML, event handlers, and unsafe links', async () => {
    const markdown =
      '<script>globalThis.compromised=true</script>\n\n<a href="javascript:alert(1)" onclick="alert(2)">bad</a>\n\n<img src="javascript:alert(3)" onerror="alert(4)">';
    const result = await renderHtmlExport(
      markdown,
      options({ standalone: false, styling: 'unstyled', embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('javascript:');
    expect(result.html).not.toContain('onclick');
    expect(result.html).not.toContain('onerror');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_URL_REJECTED' })]),
    );
  });

  it('hardens external links while leaving relative links local', async () => {
    const result = await renderHtmlExport(
      '[Web](https://example.com) [Local](guide.html)',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(result.html).toContain('<a href="guide.html">Local</a>');
  });

  it('syntax-highlights supported fenced languages', async () => {
    const result = await renderHtmlExport(
      '```typescript\nconst count: number = 2;\n```',
      options({ standalone: false, styling: 'unstyled' }),
    );
    expect(result.html).toContain('class="hljs language-typescript"');
    expect(result.html).toContain('hljs-keyword');
    expect(result.html).toContain('github');
  });

  it('safely escapes unsupported fenced languages', async () => {
    const result = await renderHtmlExport(
      '```not-a-language\n<script>x</script>\n```',
      options({ standalone: false, embedCss: false }),
    );
    expect(result.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(result.html).not.toContain('<script>x');
  });

  it('renders inline, display, and fenced math with KaTeX', async () => {
    const markdown = 'Inline $x^2$.\n\n$$\n\\frac{1}{2}\n$$\n\n```math\n\\sqrt{9}\n```';
    const result = await renderHtmlExport(
      markdown,
      options({ standalone: false, syntaxHighlighting: false }),
    );
    expect(result.hasMath).toBe(true);
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain('class="math-block"');
    expect(result.html).toContain('@font-face');
    expect(result.html).toContain('data:font/woff2;base64,');
  });

  it('does not interpret dollar signs inside ordinary code fences as math', async () => {
    const result = await renderHtmlExport(
      '```sh\necho "$HOME"\n```',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.hasMath).toBe(false);
    expect(result.html).toContain('$HOME');
    expect(result.html).not.toContain('class="katex"');
  });

  it('embeds Mermaid and initializes it with strict security', async () => {
    const result = await renderHtmlExport(
      '```mermaid\nflowchart LR\n A["<unsafe>"] --> B\n```',
      options({ embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.hasMermaid).toBe(true);
    expect(result.html).toContain('<pre class="mermaid"');
    expect(result.html).toContain('&lt;unsafe&gt;');
    expect(result.html).toContain("securityLevel:'strict'");
    expect(result.html.length).toBeGreaterThan(1_000_000);
  });

  it('exports Mermaid as inert code when diagram rendering is disabled', async () => {
    const result = await renderHtmlExport(
      '```mermaid\ngraph TD; A-->B\n```',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false, renderMermaid: false }),
    );
    expect(result.hasMermaid).toBe(false);
    expect(result.html).toContain('class="language-mermaid"');
  });

  it('emits a restrictive standalone Content Security Policy', async () => {
    const result = await renderHtmlExport('# Safe', options({ embedCss: false, syntaxHighlighting: false }));
    expect(result.html).toContain('Content-Security-Policy');
    expect(result.html).toContain('object-src &#39;none&#39;');
    expect(result.html).toContain('connect-src &#39;none&#39;');
  });

  it('rejects unsupported themes', async () => {
    await expect(
      renderHtmlExport('text', { ...options(), theme: 'unknown' as HtmlExportOptions['theme'] }),
    ).rejects.toThrow('Unsupported HTML export theme');
  });

  it('enforces the Markdown size bound', async () => {
    await expect(renderHtmlExport('x'.repeat(20_000_001), options())).rejects.toThrow('20 MB');
  });
});

describe('HTML export image handling', () => {
  it('embeds a local Unicode-named image as a data URL', async () => {
    const root = await temporaryDirectory();
    const documentPath = path.join(root, 'document.md');
    const imageDirectory = path.join(root, 'assets');
    const imagePath = path.join(imageDirectory, '東京 image.png');
    await fs.mkdir(imageDirectory);
    await fs.writeFile(documentPath, '# Image');
    await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));

    const result = await renderHtmlExport(
      '![Tokyo](assets/%E6%9D%B1%E4%BA%AC%20image.png)',
      options({
        standalone: false,
        styling: 'unstyled',
        embedCss: false,
        syntaxHighlighting: false,
        embedLocalImages: true,
      }),
      { sourcePath: documentPath },
    );
    expect(result.embeddedImageCount).toBe(1);
    expect(result.html).toContain('src="data:image/png;base64,');
    expect(result.warnings).toEqual([]);
  });

  it('rebases a linked local image relative to the output file', async () => {
    const root = await temporaryDirectory();
    const documentPath = path.join(root, 'notes', 'document.md');
    const imagePath = path.join(root, 'notes', 'assets', 'image.png');
    const outputPath = path.join(root, 'exports', 'document.html');
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    await fs.writeFile(documentPath, '');
    await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await renderHtmlExport(
      '![](assets/image.png)',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false }),
      { sourcePath: documentPath, workspaceRoot: root, outputPath },
    );
    expect(result.html).toContain('src="../notes/assets/image.png"');
    expect(result.embeddedImageCount).toBe(0);
  });

  it('reports a missing local image without failing the export', async () => {
    const root = await temporaryDirectory();
    const documentPath = path.join(root, 'document.md');
    await fs.writeFile(documentPath, '');
    const result = await renderHtmlExport(
      '![Missing](missing.png)',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false, embedLocalImages: true }),
      { sourcePath: documentPath },
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_NOT_FOUND', source: 'missing.png' })]),
    );
    expect(result.html).toContain('src="missing.png"');
  });

  it('does not read images outside the approved document and workspace roots', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const documentPath = path.join(root, 'document.md');
    const outsideImage = path.join(outside, 'secret.png');
    await fs.writeFile(documentPath, '');
    await fs.writeFile(outsideImage, Buffer.from('private-data'));
    const result = await renderHtmlExport(
      `![](${outsideImage.replace(/\\/g, '/')})`,
      options({ standalone: false, embedCss: false, syntaxHighlighting: false, embedLocalImages: true }),
      { sourcePath: documentPath, workspaceRoot: root },
    );
    expect(result.embeddedImageCount).toBe(0);
    expect(result.html).not.toContain(Buffer.from('private-data').toString('base64'));
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_OUTSIDE_ALLOWED_ROOTS' })]),
    );
  });

  it('does not read an absolute path from an unsaved document without explicit authority', async () => {
    const outside = await temporaryDirectory();
    const outsideImage = path.join(outside, 'private.png');
    await fs.writeFile(outsideImage, Buffer.from('private-data'));
    const result = await renderHtmlExport(
      `![](${outsideImage.replace(/\\/g, '/')})`,
      options({
        standalone: false,
        styling: 'unstyled',
        embedCss: false,
        syntaxHighlighting: false,
        embedLocalImages: true,
      }),
    );
    expect(result.embeddedImageCount).toBe(0);
    expect(result.html).not.toContain(Buffer.from('private-data').toString('base64'));
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_OUTSIDE_ALLOWED_ROOTS' })]),
    );
  });

  it('preserves a relative image and reports that an unsaved document has no resolution context', async () => {
    const result = await renderHtmlExport(
      '![](assets/image.png)',
      options({
        standalone: false,
        styling: 'unstyled',
        embedCss: false,
        syntaxHighlighting: false,
        embedLocalImages: true,
      }),
    );
    expect(result.html).toContain('src="assets/image.png"');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_CONTEXT_REQUIRED' })]),
    );
  });

  it('embeds an explicitly approved asset outside the document root', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const documentPath = path.join(root, 'document.md');
    const imagePath = path.join(outside, 'approved.png');
    await fs.writeFile(documentPath, '');
    await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await renderHtmlExport(
      `![](${imagePath.replace(/\\/g, '/')})`,
      options({
        standalone: false,
        styling: 'unstyled',
        embedCss: false,
        syntaxHighlighting: false,
        embedLocalImages: true,
      }),
      { sourcePath: documentPath, isLocalPathAllowed: (candidate) => candidate === imagePath },
    );
    expect(result.embeddedImageCount).toBe(1);
    expect(result.html).toContain('data:image/png;base64,');
  });

  it('rejects active SVG embedding', async () => {
    const root = await temporaryDirectory();
    const documentPath = path.join(root, 'document.md');
    await fs.writeFile(documentPath, '');
    await fs.writeFile(path.join(root, 'active.svg'), '<svg><script>alert(1)</script></svg>');
    const result = await renderHtmlExport(
      '![](active.svg)',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false, embedLocalImages: true }),
      { sourcePath: documentPath },
    );
    expect(result.embeddedImageCount).toBe(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_UNSUPPORTED_TYPE' })]),
    );
  });

  it('enforces a configurable image byte limit', async () => {
    const root = await temporaryDirectory();
    const documentPath = path.join(root, 'document.md');
    await fs.writeFile(documentPath, '');
    await fs.writeFile(path.join(root, 'large.png'), Buffer.alloc(20));
    const result = await renderHtmlExport(
      '![](large.png)',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false, embedLocalImages: true }),
      { sourcePath: documentPath, maxEmbeddedImageBytes: 10 },
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_TOO_LARGE' })]),
    );
  });

  it('retains safe remote images and rejects protocol-relative URLs', async () => {
    const result = await renderHtmlExport(
      '![](https://example.com/image.png)\n\n<img src="//evil.example/image.png">',
      options({ standalone: false, embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.html).toContain('src="https://example.com/image.png"');
    expect(result.html).not.toContain('evil.example');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'IMAGE_URL_REJECTED' })]),
    );
  });

  it('never reuses a rejected image placeholder for a later safe image', async () => {
    const result = await renderHtmlExport(
      '<img src="javascript:alert(1)"><img src="https://example.com/safe.png">',
      options({ standalone: false, styling: 'unstyled', embedCss: false, syntaxHighlighting: false }),
    );
    expect(result.html.match(/https:\/\/example\.com\/safe\.png/g)).toHaveLength(1);
    expect(result.html).not.toContain('javascript:');
  });
});

describe('HTML export file writing', () => {
  it('writes the complete HTML document atomically as UTF-8', async () => {
    const root = await temporaryDirectory();
    const outputPath = path.join(root, 'nested', 'résumé.html');
    const result = await writeHtmlExport(
      outputPath,
      '# Résumé\n\n東京',
      options({ syntaxHighlighting: false }),
    );
    const bytes = await fs.readFile(outputPath);
    expect(bytes.toString('utf8')).toContain('Résumé');
    expect(bytes.toString('utf8')).toContain('東京');
    expect(result.path).toBe(path.resolve(outputPath));
    expect(result.byteLength).toBe(bytes.length);
    expect((await fs.readdir(path.dirname(outputPath))).filter((entry) => entry.endsWith('.tmp'))).toEqual(
      [],
    );
  });

  it('requires an HTML output extension', async () => {
    const root = await temporaryDirectory();
    await expect(writeHtmlExport(path.join(root, 'document.txt'), 'text', options())).rejects.toThrow(
      '.html or .htm',
    );
  });

  it('ships every CSS and JavaScript runtime used by standalone exports', () => {
    const paths = htmlExportRuntimePaths();
    expect(Object.values(paths)).toHaveLength(4);
    expect(paths.mermaid).toMatch(/mermaid\.min\.js$/);
  });
});
