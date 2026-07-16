import path from 'node:path';
import { dialog, ipcMain } from 'electron';
import { z } from 'zod';
import type { HtmlExportRequest } from '../../src/shared/html-export';
import {
  authorizeFile,
  assertAuthorizedFile,
  assertAuthorizedWorkspace,
  isAuthorizedAsset,
  isAuthorizedFile,
} from './path-authority';
import { renderHtmlExport, writeHtmlExport } from './html-export';

export const htmlExportChannels = {
  preview: 'htmlExport:preview',
  write: 'htmlExport:write',
} as const;

const metadataSchema = z
  .object({
    title: z.string().max(500).optional(),
    author: z.string().max(500).optional(),
    description: z.string().max(2_000).optional(),
    date: z.string().max(100).optional(),
    language: z.string().max(50).optional(),
  })
  .strict();

const optionsSchema = z
  .object({
    standalone: z.boolean(),
    styling: z.enum(['styled', 'unstyled']),
    embedCss: z.boolean(),
    embedLocalImages: z.boolean(),
    includeTableOfContents: z.boolean(),
    syntaxHighlighting: z.boolean(),
    renderMath: z.boolean(),
    renderMermaid: z.boolean(),
    theme: z.enum(['markora-light', 'markora-dark', 'github-light', 'github-dark', 'print']),
    metadata: metadataSchema.optional(),
  })
  .strict();

export const htmlExportRequestSchema = z
  .object({
    markdown: z.string().max(20_000_000),
    sourcePath: z.string().min(1).max(32_767).optional(),
    workspaceRoot: z.string().min(1).max(32_767).optional(),
    options: optionsSchema,
  })
  .strict();

export function parseHtmlExportRequest(value: unknown): HtmlExportRequest {
  return htmlExportRequestSchema.parse(value);
}

function validateApprovedPaths(request: HtmlExportRequest): void {
  if (request.sourcePath) assertAuthorizedFile(request.sourcePath);
  if (request.workspaceRoot) assertAuthorizedWorkspace(request.workspaceRoot);
}

function safeDefaultFilename(request: HtmlExportRequest): string {
  const requested =
    request.options.metadata?.title?.trim() ||
    (request.sourcePath ? path.parse(request.sourcePath).name : 'Untitled');
  const sanitized = requested
    .replace(/[<>:"/\\|?*]/g, '-')
    .split('')
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return `${sanitized || 'document'}.html`;
}

export function registerHtmlExportIpc(): void {
  ipcMain.handle(htmlExportChannels.preview, async (_event, payload: unknown) => {
    const request = parseHtmlExportRequest(payload);
    validateApprovedPaths(request);
    return renderHtmlExport(request.markdown, request.options, {
      sourcePath: request.sourcePath,
      workspaceRoot: request.workspaceRoot,
      isLocalPathAllowed: (candidate) => isAuthorizedAsset(candidate) || isAuthorizedFile(candidate),
    });
  });

  ipcMain.handle(htmlExportChannels.write, async (_event, payload: unknown) => {
    const request = parseHtmlExportRequest(payload);
    validateApprovedPaths(request);
    const selection = await dialog.showSaveDialog({
      title: 'Export HTML',
      defaultPath: safeDefaultFilename(request),
      filters: [{ name: 'HTML document', extensions: ['html', 'htm'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePath) return null;
    const outputPath = authorizeFile(selection.filePath);
    return writeHtmlExport(outputPath, request.markdown, request.options, {
      sourcePath: request.sourcePath,
      workspaceRoot: request.workspaceRoot,
      isLocalPathAllowed: (candidate) => isAuthorizedAsset(candidate) || isAuthorizedFile(candidate),
    });
  });
}
