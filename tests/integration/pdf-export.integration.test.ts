import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPdfExportOptions } from '../../src/shared/pdf-options';
import {
  exportPdfToPath,
  type PdfRenderAdapter,
} from '../../electron/main/pdf-export';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function temporaryOutput(filename = 'document.pdf'): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-pdf-test-'));
  temporaryDirectories.push(directory);
  return path.join(directory, filename);
}

async function renderedDocument() {
  return {
    html: await fs.readFile(path.join(process.cwd(), 'tests', 'fixtures', 'export', 'pdf-rich-rendered.html'), 'utf8'),
    headings: [
      { depth: 1 as const, id: 'report', text: 'Release Ω रिपोर्ट' },
      { depth: 2 as const, id: 'details', text: 'Details' },
    ],
  };
}

function fakePdf(pageCount = 2): Uint8Array {
  return Buffer.from(`%PDF-1.7\n${Array.from({ length: pageCount }, (_, index) => `${index + 1} 0 obj<</Type /Page>>endobj`).join('\n')}\n%%EOF`);
}

describe('PDF export filesystem integration', () => {
  it('renders rich standalone HTML and atomically writes a validated PDF', async () => {
    const outputPath = await temporaryOutput('Unicode रिपोर्ट.pdf');
    const captured: Array<{ html: string; options: unknown }> = [];
    const renderer: PdfRenderAdapter = {
      render: vi.fn(async (html, options) => {
        captured.push({ html, options });
        return fakePdf(3);
      }),
    };
    const stages: string[] = [];
    const result = await exportPdfToPath({
      operationId: 'pdf-integration-rich',
      outputPath,
      document: await renderedDocument(),
      options: {
        ...defaultPdfExportOptions,
        title: 'Release report',
        author: 'Markora QA',
        tableOfContents: true,
        pageSize: 'A4',
        printTheme: 'light',
      },
    }, renderer, undefined, (stage) => stages.push(stage));

    expect(Buffer.from(await fs.readFile(outputPath)).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect((await fs.readdir(path.dirname(outputPath))).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    expect(result).toMatchObject({ outputPath, pageCount: 3, generatedTaggedPdf: true });
    expect(result.byteLength).toBeGreaterThan(20);
    expect(stages).toEqual(['preparing', 'rendering', 'writing', 'completed']);
    expect(captured[0].html).toContain('Release Ω रिपोर्ट');
    expect(captured[0].html).toContain('<table>');
    expect(captured[0].html).toContain('data:image/png');
    expect(captured[0].html).toContain('hljs-keyword');
    expect(captured[0].html).toContain('class="katex"');
    expect(captured[0].html).toContain('class="mermaid"');
    expect(captured[0].html).toContain('href="#report"');
  });

  it('rejects non-PDF renderer output without modifying an existing destination', async () => {
    const outputPath = await temporaryOutput();
    await fs.writeFile(outputPath, 'existing', 'utf8');
    const renderer: PdfRenderAdapter = { render: async () => Buffer.from('<html>not PDF</html>') };
    await expect(exportPdfToPath({
      operationId: 'pdf-invalid-renderer',
      outputPath,
      document: await renderedDocument(),
      options: defaultPdfExportOptions,
    }, renderer)).rejects.toMatchObject({ code: 'INVALID_PDF' });
    expect(await fs.readFile(outputPath, 'utf8')).toBe('existing');
  });

  it('replaces a save-dialog-confirmed existing PDF with the complete new file', async () => {
    const outputPath = await temporaryOutput();
    await fs.writeFile(outputPath, fakePdf(1));
    const nextPdf = fakePdf(4);
    const result = await exportPdfToPath({
      operationId: 'pdf-overwrite-existing',
      outputPath,
      document: await renderedDocument(),
      options: defaultPdfExportOptions,
    }, { render: async () => nextPdf });
    expect(Buffer.compare(Buffer.from(await fs.readFile(outputPath)), Buffer.from(nextPdf))).toBe(0);
    expect(result.pageCount).toBe(4);
  });

  it('does not write after a cancellation received while Chromium is rendering', async () => {
    const outputPath = await temporaryOutput();
    const controller = new AbortController();
    const renderer: PdfRenderAdapter = {
      render: (_html, _options, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      }),
    };
    const exportPromise = exportPdfToPath({
      operationId: 'pdf-cancel-rendering',
      outputPath,
      document: await renderedDocument(),
      options: defaultPdfExportOptions,
    }, renderer, controller.signal);
    controller.abort();
    await expect(exportPromise).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(fs.stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports an actionable write failure per destination', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-pdf-test-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'missing', 'document.pdf');
    await expect(exportPdfToPath({
      operationId: 'pdf-write-failure',
      outputPath,
      document: await renderedDocument(),
      options: defaultPdfExportOptions,
    }, { render: async () => fakePdf(1) })).rejects.toMatchObject({ code: 'WRITE_FAILED' });
  });
});
