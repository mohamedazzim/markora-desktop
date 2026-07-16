import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CanonicalDocument } from '../../src/renderer/documents/canonical-document';
import { documentModePolicy } from '../../src/renderer/documents/large-document-policy';
import { markdownToStructuredHtml, structuredHtmlToMarkdown } from '../../src/renderer/markdown/transform';
import { WorkspaceSearchService } from '../../electron/main/workspace-search';
import { renderHtmlExport } from '../../electron/main/html-export';
import { defaultHtmlExportOptions } from '../../src/shared/html-export';

interface Measurement {
  name: string;
  durationMs: number;
  details: Record<string, number | string | boolean>;
}

const measurements: Measurement[] = [];
let fixtureRoot = '';

function record(name: string, startedAt: number, details: Measurement['details']): number {
  const durationMs = Number((performance.now() - startedAt).toFixed(2));
  measurements.push({ name, durationMs, details });
  return durationMs;
}

function markdownOfSize(megabytes: number): string {
  const target = megabytes * 1024 * 1024;
  const block =
    '# Performance heading\n\nA paragraph with **bold**, a [link](https://example.com), and representative text.\n\n- [ ] task\n- item\n\n';
  return block.repeat(Math.ceil(target / block.length)).slice(0, target);
}

async function createWorkspace(root: string, count: number): Promise<void> {
  await mkdir(root, { recursive: true });
  const pending: Array<Promise<void>> = [];
  for (let index = 0; index < count; index += 1) {
    const directory = path.join(root, `group-${Math.floor(index / 100)}`);
    pending.push(
      mkdir(directory, { recursive: true }).then(() =>
        writeFile(
          path.join(directory, `document-${index}.md`),
          index % 100 === 0 ? `# Result ${index}\nneedle-${index}\n` : `# Document ${index}\nordinary text\n`,
          'utf8',
        ),
      ),
    );
    if (pending.length === 250) {
      await Promise.all(pending.splice(0));
    }
  }
  await Promise.all(pending);
}

beforeAll(async () => {
  fixtureRoot = path.join(os.tmpdir(), `markora-performance-${process.pid}-${Date.now()}`);
  await mkdir(fixtureRoot, { recursive: true });
});

afterAll(async () => {
  const outputDirectory = path.resolve('test-results');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, 'performance-results.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        measurements,
      },
      null,
      2,
    ),
    'utf8',
  );
  if (fixtureRoot.startsWith(path.join(os.tmpdir(), 'markora-performance-'))) {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

describe('realistic Markora performance workloads', () => {
  it.each([1, 5, 10])('opens and tracks a %i MiB canonical document', (megabytes) => {
    const source = markdownOfSize(megabytes);
    const memoryBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const model = CanonicalDocument.fromDisk(source);
    const duration = record(`canonical-open-${megabytes}MiB`, startedAt, {
      bytes: source.length,
      heapGrowthBytes: process.memoryUsage().heapUsed - memoryBefore,
    });
    expect(model.text.length).toBe(source.length);
    expect(duration).toBeLessThan(15_000);
  });

  it('converts 1 MiB from Markdown to structured HTML', () => {
    const megabytes = 1;
    const source = markdownOfSize(megabytes);
    const startedAt = performance.now();
    const html = markdownToStructuredHtml(source);
    const duration = record(`source-to-structured-${megabytes}MiB`, startedAt, {
      sourceBytes: source.length,
      htmlCharacters: html.length,
    });
    expect(html.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(120_000);
  });

  it.each([5, 10])('defers unsafe structured conversion for a %i MiB document', (megabytes) => {
    const source = markdownOfSize(megabytes);
    const startedAt = performance.now();
    const policy = documentModePolicy(source);
    const duration = record(`source-to-structured-deferred-${megabytes}MiB`, startedAt, {
      sourceBytes: policy.byteLength,
      structuredModeAllowed: policy.structuredModeAllowed,
      initialMode: policy.initialMode,
    });
    expect(policy.structuredModeAllowed).toBe(false);
    expect(policy.initialMode).toBe('source');
    expect(duration).toBeLessThan(1_000);
  });

  it('converts a 1 MiB structured document back to Markdown', () => {
    const source = markdownOfSize(1);
    const html = markdownToStructuredHtml(source);
    const startedAt = performance.now();
    const markdown = structuredHtmlToMarkdown(html);
    const duration = record('structured-to-source-1MiB', startedAt, {
      htmlCharacters: html.length,
      markdownCharacters: markdown.length,
    });
    expect(markdown.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(120_000);
  });

  it('handles hundreds of headings and images with bounded transformation time', () => {
    const source = Array.from(
      { length: 500 },
      (_, index) =>
        `## Heading ${index}\n\nParagraph ${index}.\n\n![Image ${index}](assets/image-${index}.png)\n`,
    ).join('\n');
    const startedAt = performance.now();
    const html = markdownToStructuredHtml(source);
    const duration = record('500-headings-500-images', startedAt, {
      sourceBytes: source.length,
      headingCount: 500,
      imageCount: 500,
    });
    expect(html.match(/<h2/g)?.length).toBe(500);
    expect(duration).toBeLessThan(30_000);
  });

  it('transforms 100 Mermaid blocks without eagerly rendering every diagram', () => {
    const source = Array.from(
      { length: 100 },
      (_, index) => `\`\`\`mermaid\nflowchart LR\n  A${index} --> B${index}\n\`\`\``,
    ).join('\n\n');
    const startedAt = performance.now();
    const html = markdownToStructuredHtml(source);
    const duration = record('100-mermaid-block-transform', startedAt, {
      diagramCount: 100,
      outputCharacters: html.length,
    });
    expect(html.match(/data-markora-fence="mermaid"/g)?.length).toBe(100);
    expect(duration).toBeLessThan(15_000);
  });

  it('keeps 50 open canonical tabs and repeated open/close cycles bounded', () => {
    const tabSource = markdownOfSize(0.02);
    const memoryBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    let tabs = Array.from({ length: 50 }, () => CanonicalDocument.fromDisk(tabSource));
    for (let cycle = 0; cycle < 500; cycle += 1) {
      tabs = tabs.slice(1);
      tabs.push(CanonicalDocument.fromDisk(tabSource));
    }
    const duration = record('50-tabs-500-open-close-cycles', startedAt, {
      tabCount: tabs.length,
      heapGrowthBytes: process.memoryUsage().heapUsed - memoryBefore,
    });
    expect(tabs).toHaveLength(50);
    expect(duration).toBeLessThan(15_000);
  });

  it('keeps canonical typing updates responsive', () => {
    const model = CanonicalDocument.fromDisk(markdownOfSize(0.1));
    const startedAt = performance.now();
    for (let index = 0; index < 100; index += 1) {
      model.replaceText(model.text.length, model.text.length, String(index % 10));
    }
    const duration = record('100-canonical-typing-updates', startedAt, {
      updates: 100,
      averageMs: 0,
    });
    measurements.at(-1)!.details.averageMs = Number((duration / 100).toFixed(3));
    expect(duration / 100).toBeLessThan(20);
  });

  it.each([5_000, 10_000])('searches a %,i-file workspace in the background service', async (count) => {
    const root = path.join(fixtureRoot, `workspace-${count}`);
    const fixtureStartedAt = performance.now();
    await createWorkspace(root, count);
    record(`fixture-create-${count}-files`, fixtureStartedAt, { fileCount: count });
    const service = new WorkspaceSearchService();
    const startedAt = performance.now();
    const result = await service.search({
      workspaceRoot: root,
      query: 'needle-',
      scope: 'content',
      respectGitignore: true,
      concurrency: 16,
      maxFiles: count + 100,
      maxMatches: count,
    });
    const duration = record(`workspace-search-${count}-files`, startedAt, {
      fileCount: count,
      searchedFiles: result.searchedFileCount,
      matches: result.matchCount,
    });
    expect(result.searchedFileCount).toBe(count);
    expect(result.matchCount).toBe(count / 100);
    expect(duration).toBeLessThan(120_000);
  });

  it('exports a rich one MiB document to standalone HTML', async () => {
    const source = `${markdownOfSize(1)}\n\n$$E=mc^2$$\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\`\n`;
    const startedAt = performance.now();
    const result = await renderHtmlExport(source, {
      ...defaultHtmlExportOptions,
      includeTableOfContents: true,
      renderMath: true,
      renderMermaid: true,
    });
    const duration = record('html-export-1MiB', startedAt, {
      outputCharacters: result.html.length,
      headings: result.headingCount,
      hasMath: result.hasMath,
      hasMermaid: result.hasMermaid,
    });
    expect(result.html).toContain('<!doctype html>');
    expect(duration).toBeLessThan(120_000);
  });
});
