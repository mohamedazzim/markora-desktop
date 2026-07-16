import { app, BrowserWindow, dialog, ipcMain, type PrintToPDFOptions } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { PdfExportProgressRecord } from '../../src/shared/contracts';
import { assertAuthorizedFile } from './path-authority';
import {
  composePrintableHtml,
  exportPdfToPath,
  PdfExportError,
  pdfExportDocumentSchema,
  pdfExportOptionsSchema,
  pdfExportRequestSchema,
  type PdfRenderAdapter,
} from './pdf-export';

const titleSchema = z.string().max(500);
const operationIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const previewSchema = z.object({
  document: pdfExportDocumentSchema,
  options: pdfExportOptionsSchema,
}).strict();

export const pdfExportChannels = {
  pickOutput: 'pdf:pickOutput',
  preview: 'pdf:preview',
  export: 'pdf:export',
  cancel: 'pdf:cancel',
  progress: 'pdf:progress',
} as const;
const approvedOutputs = new Map<string, number>();
const activeExports = new Map<string, AbortController>();
const outputApprovalLifetimeMs = 60 * 60 * 1_000;

function normalized(candidate: string): string {
  return path.resolve(candidate).toLocaleLowerCase();
}

function pruneOutputApprovals(now = Date.now()): void {
  for (const [candidate, approvedAt] of approvedOutputs) {
    if (now - approvedAt > outputApprovalLifetimeMs) approvedOutputs.delete(candidate);
  }
}

function approveOutput(candidate: string): void {
  pruneOutputApprovals();
  approvedOutputs.set(normalized(candidate), Date.now());
}

function consumeOutputApproval(candidate: string): void {
  pruneOutputApprovals();
  const key = normalized(candidate);
  if (!approvedOutputs.delete(key)) {
    throw new PdfExportError(
      'INVALID_ARGUMENT',
      'The PDF destination must be selected through Markora before exporting.',
    );
  }
}

function safeFilename(title: string): string {
  const printable = Array.from(title)
    .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
    .join('');
  return printable.replace(/[<>:"/\\|?*]/g, '_').trim().replace(/[. ]+$/g, '').slice(0, 180) || 'document';
}

function rendererError(error: unknown): Error {
  if (error instanceof PdfExportError) {
    const result = new Error(`${error.code}: ${error.message}`);
    result.name = 'PdfExportError';
    return result;
  }
  if (error instanceof z.ZodError) {
    return new Error(`INVALID_ARGUMENT: ${error.issues.map((issue) => issue.message).join(' ')}`);
  }
  return error instanceof Error ? error : new Error('PDF export failed.');
}

async function bestEffortRemove(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      // Temporary-file cleanup must not hide an export result or its original error.
    }
  }
}

async function bestEffortRemoveDirectory(directory: string): Promise<void> {
  try {
    await fs.rmdir(directory);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      // The directory is intentionally left behind if another process still holds it.
    }
  }
}

class ChromiumPdfRenderer implements PdfRenderAdapter {
  async render(html: string, options: PrintToPDFOptions, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) throw new DOMException('PDF export cancelled.', 'AbortError');
    const tempRoot = path.join(app.getPath('temp'), 'Markora');
    await fs.mkdir(tempRoot, { recursive: true });
    const tempDirectory = await fs.mkdtemp(path.join(tempRoot, 'pdf-'));
    const htmlPath = path.join(tempDirectory, 'document.html');
    await fs.writeFile(htmlPath, html, 'utf8');
    const window = new BrowserWindow({
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Page-authored script is blocked by the generated CSP and HTML validator;
        // JavaScript remains available for the fixed resource-readiness probe below.
        javascript: true,
        webSecurity: true,
        partition: `markora-pdf-${path.basename(tempDirectory)}`,
      },
    });
    const abort = () => {
      if (!window.isDestroyed()) window.destroy();
    };
    signal?.addEventListener('abort', abort, { once: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const allowedUrl = pathToFileURL(htmlPath).href;
    window.webContents.on('will-navigate', (event, target) => {
      if (target !== allowedUrl) event.preventDefault();
    });
    try {
      await window.loadFile(htmlPath);
      if (signal?.aborted) throw new DOMException('PDF export cancelled.', 'AbortError');
      // This fixed script only waits for resources. Document-authored scripts stay disabled.
      await window.webContents.executeJavaScript(`Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        ...Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 10000);
        }))
      ]).then(() => true)`, true);
      if (signal?.aborted) throw new DOMException('PDF export cancelled.', 'AbortError');
      return await window.webContents.printToPDF(options);
    } finally {
      signal?.removeEventListener('abort', abort);
      if (!window.isDestroyed()) window.destroy();
      await bestEffortRemove(htmlPath);
      await bestEffortRemoveDirectory(tempDirectory);
    }
  }
}

const chromiumRenderer = new ChromiumPdfRenderer();

const progressMessages: Record<PdfExportProgressRecord['stage'], string> = {
  preparing: 'Preparing the print document…',
  rendering: 'Rendering pages with Chromium…',
  writing: 'Writing the PDF atomically…',
  completed: 'PDF export completed.',
};

export function registerPdfExportIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(pdfExportChannels.pickOutput, async (_event, titleInput: unknown) => {
    const title = titleSchema.parse(titleInput);
    const selection = await dialog.showSaveDialog({
      defaultPath: `${safeFilename(title)}.pdf`,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    approveOutput(selection.filePath);
    return { path: selection.filePath, displayName: path.basename(selection.filePath) };
  });

  ipcMain.handle(pdfExportChannels.preview, (_event, payload: unknown) => {
    try {
      const request = previewSchema.parse(payload);
      if (request.document.sourcePath) assertAuthorizedFile(request.document.sourcePath);
      return composePrintableHtml(request.document, request.options);
    } catch (error) {
      throw rendererError(error);
    }
  });

  ipcMain.handle(pdfExportChannels.export, async (_event, payload: unknown) => {
    let operationId: string | undefined;
    try {
      const request = pdfExportRequestSchema.parse(payload);
      operationId = request.operationId;
      if (request.document.sourcePath) assertAuthorizedFile(request.document.sourcePath);
      consumeOutputApproval(request.outputPath);
      if (activeExports.has(request.operationId)) {
        throw new PdfExportError('INVALID_ARGUMENT', 'The PDF operation identifier is already active.');
      }
      const controller = new AbortController();
      activeExports.set(request.operationId, controller);
      const sendProgress = (stage: PdfExportProgressRecord['stage']) => {
        getWindow()?.webContents.send(pdfExportChannels.progress, {
          operationId: request.operationId,
          stage,
          message: progressMessages[stage],
        } satisfies PdfExportProgressRecord);
      };
      try {
        return await exportPdfToPath(request, chromiumRenderer, controller.signal, sendProgress);
      } finally {
        activeExports.delete(request.operationId);
      }
    } catch (error) {
      if (operationId) activeExports.delete(operationId);
      throw rendererError(error);
    }
  });

  ipcMain.handle(pdfExportChannels.cancel, (_event, input: unknown) => {
    const operationId = operationIdSchema.parse(input);
    const controller = activeExports.get(operationId);
    if (!controller) return false;
    controller.abort();
    return true;
  });
}
