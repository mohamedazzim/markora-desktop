import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrintToPDFOptions } from 'electron';
import { z } from 'zod';
import type {
  PdfExportDocument,
  PdfExportOptions,
  PdfExportRequest,
  PdfExportResult,
  PdfHeadingRecord,
  PdfPreviewRecord,
} from '../../src/shared/contracts';
import { pdfExportOptionsSchema } from '../../src/shared/pdf-options';

export { defaultPdfExportOptions, pdfExportOptionsSchema } from '../../src/shared/pdf-options';

const millimetresToInches = (value: number) => value / 25.4;

const headingSchema = z.object({
  depth: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  text: z.string().max(2_000),
  id: z.string().min(1).max(2_000),
}).strict();
export const pdfExportDocumentSchema = z.object({
  html: z.string().max(40_000_000),
  headings: z.array(headingSchema).max(25_000),
  sourcePath: z.string().min(1).max(32_000).optional(),
}).strict();
export const pdfExportRequestSchema = z.object({
  operationId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  outputPath: z.string().min(1).max(32_000),
  document: pdfExportDocumentSchema,
  options: pdfExportOptionsSchema,
}).strict();

const knownPageDimensionsMm: Record<Exclude<PdfExportOptions['pageSize'], 'Custom'>, [number, number]> = {
  A0: [841, 1_189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  Legal: [215.9, 355.6],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
  Ledger: [431.8, 279.4],
};

export class PdfExportError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ARGUMENT'
      | 'UNSAFE_HTML'
      | 'UNSAFE_PRINT_CSS'
      | 'CANCELLED'
      | 'INVALID_PDF'
      | 'WRITE_FAILED',
    message: string,
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'PdfExportError';
  }
}

export function validatePdfOptions(input: unknown): PdfExportOptions {
  const result = pdfExportOptionsSchema.safeParse(input);
  if (!result.success) {
    throw new PdfExportError(
      'INVALID_ARGUMENT',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
      result.error,
    );
  }
  return result.data;
}

export function validatePdfDocument(input: unknown): PdfExportDocument {
  const result = pdfExportDocumentSchema.safeParse(input);
  if (!result.success) {
    throw new PdfExportError(
      'INVALID_ARGUMENT',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
      result.error,
    );
  }
  if (result.data.sourcePath && (!path.isAbsolute(result.data.sourcePath) || result.data.sourcePath.includes('\0'))) {
    throw new PdfExportError('INVALID_ARGUMENT', 'The source document path must be an absolute path.');
  }
  return result.data;
}

export function sanitizePrintCss(css: string): string {
  if (css.length > 50_000) throw new PdfExportError('UNSAFE_PRINT_CSS', 'Print CSS must be 50 KB or smaller.');
  const scan = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').toLowerCase();
  if (
    /<\/?style|<\/?script|@import|@font-face|url\(|javascript:|vbscript:|expression\(|behavior:|-moz-binding/.test(scan)
  ) {
    throw new PdfExportError(
      'UNSAFE_PRINT_CSS',
      'Print CSS cannot contain external resources, executable constructs, or HTML tags.',
    );
  }
  let depth = 0;
  for (const character of css) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth < 0 || depth > 8) {
      throw new PdfExportError('UNSAFE_PRINT_CSS', 'Print CSS contains unbalanced or excessively nested blocks.');
    }
  }
  if (depth !== 0) throw new PdfExportError('UNSAFE_PRINT_CSS', 'Print CSS contains unbalanced blocks.');
  return css;
}

/** Defense in depth for renderer-sanitized export markup before it enters a privileged process. */
export function assertSafeRenderedHtml(html: string): void {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  if (
    /<\s*\/?\s*(?:script|iframe|frame|object|embed|applet|webview|base|meta|link|form)\b/i.test(withoutComments)
    || /\s(?:on[a-z]+|srcdoc)\s*=/i.test(withoutComments)
    || /(?:javascript|vbscript)\s*:/i.test(withoutComments)
    || /data\s*:\s*text\/html/i.test(withoutComments)
    || /@import|url\s*\(/i.test(withoutComments)
  ) {
    throw new PdfExportError(
      'UNSAFE_HTML',
      'Rendered HTML contains an active element, event handler, or executable URL.',
    );
  }
}

export function pageDimensionsMm(optionsInput: PdfExportOptions): { width: number; height: number } {
  const options = validatePdfOptions(optionsInput);
  const dimensions = options.pageSize === 'Custom'
    ? [options.customPageSize!.widthMm, options.customPageSize!.heightMm] as const
    : knownPageDimensionsMm[options.pageSize];
  const [portraitWidth, portraitHeight] = dimensions[0] <= dimensions[1]
    ? dimensions
    : [dimensions[1], dimensions[0]];
  return options.orientation === 'landscape'
    ? { width: portraitHeight, height: portraitWidth }
    : { width: portraitWidth, height: portraitHeight };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]!));

function safeBaseHref(sourcePath: string | undefined): string {
  if (!sourcePath) return '';
  const directoryUrl = pathToFileURL(`${path.dirname(sourcePath)}${path.sep}`).href;
  return `<base href="${escapeHtml(directoryUrl)}">`;
}

function themeCss(options: PdfExportOptions): string {
  const theme = options.lightThemeOverride ? 'light' : options.printTheme;
  if (theme === 'dark') {
    return ':root{--pdf-bg:#111827;--pdf-fg:#f3f4f6;--pdf-muted:#9ca3af;--pdf-border:#4b5563;--pdf-code:#1f2937;--pdf-link:#93c5fd}';
  }
  if (theme === 'sepia') {
    return ':root{--pdf-bg:#fbf2df;--pdf-fg:#3d3327;--pdf-muted:#766956;--pdf-border:#c9b99d;--pdf-code:#f1e4cd;--pdf-link:#76561f}';
  }
  if (theme === 'document') {
    return ':root{--pdf-bg:var(--markora-background,#fff);--pdf-fg:var(--markora-foreground,#1f2937);--pdf-muted:var(--markora-muted,#6b7280);--pdf-border:var(--markora-border,#d1d5db);--pdf-code:var(--markora-code,#f3f4f6);--pdf-link:var(--markora-link,#1d4ed8)}';
  }
  return ':root{--pdf-bg:#fff;--pdf-fg:#1f2937;--pdf-muted:#6b7280;--pdf-border:#d1d5db;--pdf-code:#f3f4f6;--pdf-link:#1d4ed8}';
}

function pageBreakCss(options: PdfExportOptions): string {
  const rules: string[] = [];
  for (const depth of [...new Set(options.pageBreaks.beforeHeadings)].sort()) {
    rules.push(`.markora-pdf-document h${depth}{break-before:page;page-break-before:always}`);
  }
  if (options.pageBreaks.avoidInsideTables) rules.push('.markora-pdf-document table{break-inside:avoid;page-break-inside:avoid}');
  if (options.pageBreaks.avoidInsideCodeBlocks) rules.push('.markora-pdf-document pre{break-inside:avoid;page-break-inside:avoid}');
  if (options.pageBreaks.avoidInsideBlockquotes) rules.push('.markora-pdf-document blockquote{break-inside:avoid;page-break-inside:avoid}');
  if (options.pageBreaks.keepHeadingWithNext) rules.push('.markora-pdf-document h1,.markora-pdf-document h2,.markora-pdf-document h3,.markora-pdf-document h4,.markora-pdf-document h5,.markora-pdf-document h6{break-after:avoid;page-break-after:avoid}');
  return rules.join('\n');
}

function tableOfContents(headings: PdfHeadingRecord[]): string {
  if (headings.length === 0) return '';
  const items = headings.map((heading) => (
    `<li class="toc-depth-${heading.depth}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`
  )).join('');
  return `<nav class="markora-pdf-toc" aria-label="Table of contents"><h2>Table of contents</h2><ol>${items}</ol></nav>`;
}

const basePrintCss = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--pdf-bg);color:var(--pdf-fg)}
body{font:16px/1.6 "Segoe UI",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.markora-pdf-document{overflow-wrap:anywhere}
.markora-pdf-metadata{border-bottom:1px solid var(--pdf-border);color:var(--pdf-muted);margin:0 0 2rem;padding:0 0 1rem}
.markora-pdf-metadata h1{color:var(--pdf-fg);margin:0 0 .5rem}
.markora-pdf-metadata p{margin:.125rem 0}
.markora-pdf-toc{break-after:page;page-break-after:always}
.markora-pdf-toc ol{list-style:none;padding:0}
.markora-pdf-toc li{margin:.25rem 0}.markora-pdf-toc .toc-depth-2{padding-left:1rem}.markora-pdf-toc .toc-depth-3{padding-left:2rem}
.markora-pdf-toc .toc-depth-4{padding-left:3rem}.markora-pdf-toc .toc-depth-5{padding-left:4rem}.markora-pdf-toc .toc-depth-6{padding-left:5rem}
a{color:var(--pdf-link);text-decoration:underline;text-underline-offset:.12em}
img,svg,video{max-width:100%;height:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid var(--pdf-border);padding:.4rem .55rem;text-align:left}
pre{background:var(--pdf-code);border:1px solid var(--pdf-border);border-radius:5px;overflow-wrap:anywhere;padding:.85rem;white-space:pre-wrap}
code,kbd,samp{font-family:Consolas,"Cascadia Mono",monospace}blockquote{border-left:4px solid var(--pdf-border);color:var(--pdf-muted);margin-left:0;padding-left:1rem}
.katex-display{overflow:visible}.mermaid svg{max-width:100%}
@media print{a[href^="http"]::after{content:""}}
`;

function metadataMarkup(options: PdfExportOptions): string {
  if (!options.title && !options.author && !options.date) return '';
  return `<header class="markora-pdf-metadata">
${options.title ? `<h1>${escapeHtml(options.title)}</h1>` : ''}
${options.author ? `<p><strong>Author:</strong> ${escapeHtml(options.author)}</p>` : ''}
${options.date ? `<p><strong>Date:</strong> ${escapeHtml(options.date)}</p>` : ''}
</header>`;
}

export function composePrintableHtml(
  documentInput: PdfExportDocument,
  optionsInput: PdfExportOptions,
): PdfPreviewRecord {
  const document = validatePdfDocument(documentInput);
  const options = validatePdfOptions(optionsInput);
  assertSafeRenderedHtml(document.html);
  const printCss = sanitizePrintCss(options.printCss);
  const dimensions = pageDimensionsMm(options);
  const remoteSources = options.allowRemoteImages ? ' https: http:' : '';
  const csp = `default-src 'none'; img-src data: blob: file:${remoteSources}; style-src 'unsafe-inline'; font-src data: file:; media-src data: file:${remoteSources}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self' file:`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
${safeBaseHref(document.sourcePath)}
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.title || 'Markora document')}</title>
<style>${themeCss(options)}
@page{size:${dimensions.width}mm ${dimensions.height}mm}
${basePrintCss}
${pageBreakCss(options)}
${printCss}</style></head><body>
${metadataMarkup(options)}
${options.tableOfContents ? tableOfContents(document.headings) : ''}
<main class="markora-pdf-document" data-markora-pdf-document>${document.html}</main>
</body></html>`;
  return { html, pageWidthMm: dimensions.width, pageHeightMm: dimensions.height };
}

function templateText(text: string, options: PdfExportOptions): string {
  const markerMap = new Map<string, string>([
    ['{{title}}', escapeHtml(options.title)],
    ['{{author}}', escapeHtml(options.author)],
    ['{{date}}', escapeHtml(options.date)],
    ['{{page}}', '<span class="pageNumber"></span>'],
    ['{{pages}}', '<span class="totalPages"></span>'],
  ]);
  const tokens = /\{\{(?:title|author|date|page|pages)\}\}/g;
  let cursor = 0;
  let output = '';
  for (const match of text.matchAll(tokens)) {
    output += escapeHtml(text.slice(cursor, match.index));
    output += markerMap.get(match[0]) ?? '';
    cursor = (match.index ?? 0) + match[0].length;
  }
  return output + escapeHtml(text.slice(cursor));
}

function chromeTemplate(content: string, side: 'header' | 'footer'): string {
  return `<div style="box-sizing:border-box;color:#4b5563;font-family:'Segoe UI',sans-serif;font-size:9px;padding:${side === 'header' ? '4px 18mm 0' : '0 18mm 4px'};text-align:${side === 'header' ? 'left' : 'center'};width:100%">${content || '&nbsp;'}</div>`;
}

export function toElectronPrintOptions(optionsInput: PdfExportOptions): PrintToPDFOptions {
  const options = validatePdfOptions(optionsInput);
  const headerEnabled = options.header.enabled;
  const footerEnabled = options.footer.enabled || options.pageNumbers;
  let footerText = options.footer.enabled ? options.footer.text : '';
  if (options.pageNumbers && !/\{\{page(?:s)?\}\}/.test(footerText)) {
    footerText = footerText ? `${footerText} · {{page}} / {{pages}}` : '{{page}} / {{pages}}';
  }
  return {
    landscape: options.orientation === 'landscape',
    displayHeaderFooter: headerEnabled || footerEnabled,
    printBackground: options.printBackground,
    scale: options.scale,
    pageSize: options.pageSize === 'Custom'
      ? {
          width: millimetresToInches(options.customPageSize!.widthMm),
          height: millimetresToInches(options.customPageSize!.heightMm),
        }
      : options.pageSize,
    margins: {
      // printToPDF uses inches (unlike webContents.print, whose margins use pixels).
      top: millimetresToInches(options.margins.top),
      right: millimetresToInches(options.margins.right),
      bottom: millimetresToInches(options.margins.bottom),
      left: millimetresToInches(options.margins.left),
    },
    headerTemplate: chromeTemplate(
      headerEnabled ? templateText(options.header.text, options) : '',
      'header',
    ),
    footerTemplate: chromeTemplate(
      footerEnabled ? templateText(footerText, options) : '',
      'footer',
    ),
    preferCSSPageSize: false,
    generateTaggedPDF: options.generateTaggedPdf,
    generateDocumentOutline: options.generateDocumentOutline,
  };
}

export function countPdfPages(pdf: Uint8Array): number | null {
  const source = Buffer.from(pdf).toString('latin1');
  const matches = source.match(/\/Type\s*\/Page\b/g);
  return matches?.length ? matches.length : null;
}

async function writePdfAtomically(outputPath: string, pdf: Uint8Array): Promise<void> {
  if (!path.isAbsolute(outputPath) || outputPath.includes('\0') || path.extname(outputPath).toLowerCase() !== '.pdf') {
    throw new PdfExportError('INVALID_ARGUMENT', 'Choose an absolute .pdf destination.');
  }
  const directory = path.dirname(outputPath);
  const temporaryPath = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`);
  const replacedPath = `${temporaryPath}.previous`;
  try {
    await fs.writeFile(temporaryPath, pdf, { flag: 'wx' });
    try {
      await fs.rename(temporaryPath, outputPath);
    } catch (renameError) {
      // Windows does not consistently replace an existing destination with rename().
      // Move the confirmed destination aside, install the complete temp file, then remove it.
      try {
        await fs.stat(outputPath);
      } catch {
        throw renameError;
      }
      await fs.rename(outputPath, replacedPath);
      try {
        await fs.rename(temporaryPath, outputPath);
      } catch (replacementError) {
        await fs.rename(replacedPath, outputPath);
        throw replacementError;
      }
      try {
        await fs.unlink(replacedPath);
      } catch {
        // A stale previous-version file is preferable to reporting a failed export
        // after the requested PDF has already been installed successfully.
      }
    }
  } catch (error) {
    try {
      await fs.unlink(temporaryPath);
    } catch {
      // Preserve the original failure; cleanup is best effort.
    }
    try {
      await fs.stat(replacedPath);
      await fs.rename(replacedPath, outputPath);
    } catch {
      // Either no previous destination existed or recovery was not possible.
    }
    throw new PdfExportError('WRITE_FAILED', `Could not write the PDF to ${outputPath}.`, error);
  }
}

export interface PdfRenderAdapter {
  render(html: string, options: PrintToPDFOptions, signal?: AbortSignal): Promise<Uint8Array>;
}

export async function exportPdfToPath(
  requestInput: PdfExportRequest,
  renderer: PdfRenderAdapter,
  signal?: AbortSignal,
  onStage?: (stage: 'preparing' | 'rendering' | 'writing' | 'completed') => void,
): Promise<PdfExportResult> {
  const parsed = pdfExportRequestSchema.safeParse(requestInput);
  if (!parsed.success) {
    throw new PdfExportError(
      'INVALID_ARGUMENT',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' '),
      parsed.error,
    );
  }
  const request = parsed.data;
  if (signal?.aborted) throw new PdfExportError('CANCELLED', 'PDF export was cancelled.');
  const startedAt = Date.now();
  onStage?.('preparing');
  const preview = composePrintableHtml(request.document, request.options);
  onStage?.('rendering');
  let pdf: Uint8Array;
  try {
    pdf = await renderer.render(preview.html, toElectronPrintOptions(request.options), signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new PdfExportError('CANCELLED', 'PDF export was cancelled.', error);
    }
    throw error;
  }
  if (signal?.aborted) throw new PdfExportError('CANCELLED', 'PDF export was cancelled.');
  if (pdf.byteLength < 5 || Buffer.from(pdf.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new PdfExportError('INVALID_PDF', 'Chromium did not return a valid PDF document.');
  }
  onStage?.('writing');
  await writePdfAtomically(request.outputPath, pdf);
  onStage?.('completed');
  return {
    operationId: request.operationId,
    outputPath: request.outputPath,
    byteLength: pdf.byteLength,
    pageCount: countPdfPages(pdf),
    durationMs: Date.now() - startedAt,
    generatedTaggedPdf: request.options.generateTaggedPdf,
    generatedDocumentOutline: request.options.generateDocumentOutline,
  };
}
