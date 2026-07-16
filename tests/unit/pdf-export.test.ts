import { describe, expect, it, vi } from 'vitest';
import type { PdfExportOptions } from '../../src/shared/contracts';
import { defaultPdfExportOptions } from '../../src/shared/pdf-options';
import {
  assertSafeRenderedHtml,
  composePrintableHtml,
  countPdfPages,
  exportPdfToPath,
  pageDimensionsMm,
  PdfExportError,
  sanitizePrintCss,
  toElectronPrintOptions,
  validatePdfOptions,
} from '../../electron/main/pdf-export';

function options(overrides: Partial<PdfExportOptions> = {}): PdfExportOptions {
  return {
    ...defaultPdfExportOptions,
    ...overrides,
    margins: { ...defaultPdfExportOptions.margins, ...overrides.margins },
    header: { ...defaultPdfExportOptions.header, ...overrides.header },
    footer: { ...defaultPdfExportOptions.footer, ...overrides.footer },
    pageBreaks: { ...defaultPdfExportOptions.pageBreaks, ...overrides.pageBreaks },
  };
}

const document = {
  html: '<h1 id="intro">Unicode Ω नमस्ते</h1><table><tr><td>Cell</td></tr></table><div class="math-block"><span class="katex">x²</span></div><div class="mermaid"><svg aria-label="Graph"><path d="M0 0L1 1"/></svg></div><img src="assets/photo.png" alt="Photo">',
  headings: [{ depth: 1 as const, text: 'Unicode Ω नमस्ते', id: 'intro' }],
  sourcePath: 'C:\\Docs\\guide.md',
};

describe('PDF option validation and Chromium mapping', () => {
  it('accepts the complete default option set', () => {
    expect(validatePdfOptions(defaultPdfExportOptions)).toEqual(defaultPdfExportOptions);
  });

  it('requires dimensions for Custom and bounds scale and margins', () => {
    expect(() => validatePdfOptions(options({ pageSize: 'Custom' }))).toThrow(/width and height/i);
    expect(() => validatePdfOptions(options({ scale: 2.01 }))).toThrow(PdfExportError);
    expect(() => validatePdfOptions(options({ margins: { top: -1, right: 0, bottom: 0, left: 0 } }))).toThrow(/greater than or equal to 0/i);
  });

  it('rejects unknown root and nested option fields at the IPC boundary', () => {
    expect(() => validatePdfOptions({ ...options(), injected: true })).toThrow(/Unrecognized key/i);
    expect(() => validatePdfOptions({
      ...options(),
      margins: { ...defaultPdfExportOptions.margins, injected: 1 },
    })).toThrow(/Unrecognized key/i);
  });

  it('calculates standard, custom, portrait, and landscape dimensions', () => {
    expect(pageDimensionsMm(options({ pageSize: 'A4' }))).toEqual({ width: 210, height: 297 });
    expect(pageDimensionsMm(options({ pageSize: 'A4', orientation: 'landscape' }))).toEqual({ width: 297, height: 210 });
    expect(pageDimensionsMm(options({ pageSize: 'Custom', customPageSize: { widthMm: 200, heightMm: 300 }, orientation: 'landscape' }))).toEqual({ width: 300, height: 200 });
  });

  it('maps every print control to an Electron printToPDF option', () => {
    const result = toElectronPrintOptions(options({
      pageSize: 'Custom',
      customPageSize: { widthMm: 254, heightMm: 508 },
      orientation: 'landscape',
      margins: { top: 25.4, right: 12.7, bottom: 6.35, left: 0 },
      scale: 1.25,
      printBackground: false,
      header: { enabled: true, text: '{{title}} — {{author}} <unsafe>' },
      footer: { enabled: true, text: '{{date}}' },
      pageNumbers: true,
      title: 'Title',
      author: 'Author',
      date: '2026-07-15',
      generateTaggedPdf: true,
      generateDocumentOutline: true,
    }));

    expect(result.pageSize).toEqual({ width: 10, height: 20 });
    expect(result.landscape).toBe(true);
    expect(result.scale).toBe(1.25);
    expect(result.printBackground).toBe(false);
    expect(result.margins).toMatchObject({ top: 1, right: 0.5, bottom: 0.25, left: 0 });
    expect(result.displayHeaderFooter).toBe(true);
    expect(result.headerTemplate).toContain('Title — Author &lt;unsafe&gt;');
    expect(result.footerTemplate).toContain('2026-07-15 · <span class="pageNumber"></span>');
    expect(result.generateTaggedPDF).toBe(true);
    expect(result.generateDocumentOutline).toBe(true);
  });

  it('adds page numbers even when the custom footer is disabled', () => {
    const result = toElectronPrintOptions(options({ footer: { enabled: false, text: 'ignored' }, pageNumbers: true }));
    expect(result.displayHeaderFooter).toBe(true);
    expect(result.footerTemplate).toContain('pageNumber');
    expect(result.footerTemplate).toContain('totalPages');
  });
});

describe('PDF HTML and CSS security', () => {
  it('allows local print rules without rewriting them', () => {
    const css = '@media print { h2 { break-before: page; color: #123; } }';
    expect(sanitizePrintCss(css)).toBe(css);
  });

  it.each([
    '@import "https://tracker.invalid/style.css";',
    'p { background: url(https://tracker.invalid/pixel); }',
    'p { width: expression(alert(1)); }',
    '</style><script>alert(1)</script>',
    'p { color: red;',
  ])('rejects unsafe or malformed print CSS: %s', (css) => {
    expect(() => sanitizePrintCss(css)).toThrow(PdfExportError);
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src="x" onerror="alert(1)">',
    '<iframe srcdoc="unsafe"></iframe>',
    '<a href="javascript:alert(1)">bad</a>',
    '<object data="file:///secret"></object>',
    '<p style="background:url(https://tracker.invalid/pixel)">bad</p>',
  ])('rejects active renderer HTML: %s', (html) => {
    expect(() => assertSafeRenderedHtml(html)).toThrow(PdfExportError);
  });

  it('allows inert rich content required by PDF fixtures', () => {
    expect(() => assertSafeRenderedHtml(document.html)).not.toThrow();
  });
});

describe('print document composition', () => {
  it('preserves Unicode, tables, images, KaTeX, Mermaid SVG, and internal links', () => {
    const result = composePrintableHtml(document, options({
      title: 'Guide <2026>',
      author: 'Ada & Grace',
      date: '2026-07-15',
      tableOfContents: true,
      pageBreaks: { ...defaultPdfExportOptions.pageBreaks, beforeHeadings: [1, 3] },
      printCss: '.markora-pdf-document { font-size: 11pt; }',
    }));

    expect(result.html).toContain('Unicode Ω नमस्ते');
    expect(result.html).toContain('<table>');
    expect(result.html).toContain('assets/photo.png');
    expect(result.html).toContain('class="katex"');
    expect(result.html).toContain('<svg aria-label="Graph">');
    expect(result.html).toContain('href="#intro"');
    expect(result.html).toContain('Guide &lt;2026&gt;');
    expect(result.html).toContain('Ada &amp; Grace');
    expect(result.html).toContain('.markora-pdf-document h1{break-before:page');
    expect(result.html).toContain('.markora-pdf-document { font-size: 11pt; }');
    expect(result.html).toContain('<base href="file:///C:/Docs/">');
    expect(result.pageWidthMm).toBe(210);
    expect(result.pageHeightMm).toBe(297);
  });

  it('blocks remote images by default and opts in explicitly', () => {
    const blocked = composePrintableHtml(document, options()).html;
    const allowed = composePrintableHtml(document, options({ allowRemoteImages: true })).html;
    expect(blocked).toContain('img-src data: blob: file:;');
    expect(blocked).not.toContain('file: https:');
    expect(allowed).toContain('img-src data: blob: file: https: http:;');
  });

  it('forces a light palette when light override is enabled', () => {
    const html = composePrintableHtml(document, options({ printTheme: 'dark', lightThemeOverride: true })).html;
    expect(html).toContain('--pdf-bg:#fff');
    expect(html).not.toContain('--pdf-bg:#111827');
  });
});

describe('PDF output validation seams', () => {
  it('counts uncompressed page objects and reports unknown compressed structures', () => {
    expect(countPdfPages(Buffer.from('%PDF-1.7\n<</Type /Page>>\n<</Type/Page>>'))).toBe(2);
    expect(countPdfPages(Buffer.from('%PDF-1.7\ncompressed'))).toBeNull();
  });

  it('does not call the renderer if already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const render = vi.fn();
    await expect(exportPdfToPath({
      operationId: 'pdf-cancelled',
      outputPath: 'C:\\Exports\\cancelled.pdf',
      document,
      options: options(),
    }, { render }, controller.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(render).not.toHaveBeenCalled();
  });
});
