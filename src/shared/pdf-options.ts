import { z } from 'zod';
import type { PdfExportOptions } from './contracts';

const finiteNumber = z.number().finite();

export const pdfExportOptionsSchema = z.object({
  pageSize: z.enum([
    'A0',
    'A1',
    'A2',
    'A3',
    'A4',
    'A5',
    'A6',
    'Legal',
    'Letter',
    'Tabloid',
    'Ledger',
    'Custom',
  ]),
  customPageSize: z.object({
    widthMm: finiteNumber.min(25.4).max(5_080),
    heightMm: finiteNumber.min(25.4).max(5_080),
  }).strict().optional(),
  orientation: z.enum(['portrait', 'landscape']),
  margins: z.object({
    top: finiteNumber.min(0).max(100),
    right: finiteNumber.min(0).max(100),
    bottom: finiteNumber.min(0).max(100),
    left: finiteNumber.min(0).max(100),
  }).strict(),
  scale: finiteNumber.min(0.25).max(2),
  printBackground: z.boolean(),
  header: z.object({ enabled: z.boolean(), text: z.string().max(2_000) }).strict(),
  footer: z.object({ enabled: z.boolean(), text: z.string().max(2_000) }).strict(),
  pageNumbers: z.boolean(),
  title: z.string().max(500),
  author: z.string().max(500),
  date: z.string().max(100),
  tableOfContents: z.boolean(),
  printTheme: z.enum(['document', 'light', 'dark', 'sepia']),
  lightThemeOverride: z.boolean(),
  printCss: z.string().max(50_000),
  pageBreaks: z.object({
    beforeHeadings: z.array(z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ])).max(6),
    avoidInsideTables: z.boolean(),
    avoidInsideCodeBlocks: z.boolean(),
    avoidInsideBlockquotes: z.boolean(),
    keepHeadingWithNext: z.boolean(),
  }).strict(),
  allowRemoteImages: z.boolean(),
  generateTaggedPdf: z.boolean(),
  generateDocumentOutline: z.boolean(),
}).strict().superRefine((options, context) => {
  if (options.pageSize === 'Custom' && !options.customPageSize) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customPageSize'],
      message: 'A width and height are required for a custom page size.',
    });
  }
});

export const defaultPdfExportOptions: PdfExportOptions = {
  pageSize: 'A4',
  orientation: 'portrait',
  margins: { top: 18, right: 18, bottom: 18, left: 18 },
  scale: 1,
  printBackground: true,
  header: { enabled: false, text: '{{title}}' },
  footer: { enabled: false, text: '' },
  pageNumbers: true,
  title: '',
  author: '',
  date: '',
  tableOfContents: false,
  printTheme: 'document',
  lightThemeOverride: false,
  printCss: '',
  pageBreaks: {
    beforeHeadings: [],
    avoidInsideTables: true,
    avoidInsideCodeBlocks: true,
    avoidInsideBlockquotes: true,
    keepHeadingWithNext: true,
  },
  allowRemoteImages: false,
  generateTaggedPdf: true,
  generateDocumentOutline: true,
};
