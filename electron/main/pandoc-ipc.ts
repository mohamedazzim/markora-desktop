import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  PandocExportFormat,
  PandocImportFormat,
  PandocStatusRecord,
} from '../../src/shared/contracts';
import {
  detectPandoc,
  PandocError,
  runPandocConversion,
  type PandocDetectionResult,
  type PandocProgress,
} from './pandoc';

const operationIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const executableSchema = z.string().min(1).max(32_000);
const exportFormatSchema = z.enum(['docx', 'odt', 'rtf', 'epub', 'latex', 'mediawiki', 'plain']);
const importFormatSchema = z.enum(['docx', 'odt', 'rtf', 'html', 'latex']);
const previewSchema = z.object({
  operationId: operationIdSchema,
  executablePath: executableSchema,
  format: importFormatSchema,
  inputPath: z.string().min(1).max(32_000),
});
const exportSchema = z.object({
  operationId: operationIdSchema,
  executablePath: executableSchema,
  format: exportFormatSchema,
  outputPath: z.string().min(1).max(32_000),
  markdown: z.string().max(20_000_000),
  metadata: z.object({
    title: z.string().max(500).optional(),
    author: z.string().max(500).optional(),
    date: z.string().max(100).optional(),
  }).optional(),
});

const exportExtensions: Record<PandocExportFormat, string> = {
  docx: 'docx', odt: 'odt', rtf: 'rtf', epub: 'epub', latex: 'tex',
  mediawiki: 'mediawiki', plain: 'txt',
};
const importExtensions: Record<PandocImportFormat, string[]> = {
  docx: ['docx'], odt: ['odt'], rtf: ['rtf'], html: ['html', 'htm'], latex: ['tex', 'latex'],
};
const approvedExecutables = new Set<string>();
const approvedInputs = new Set<string>();
const approvedOutputs = new Set<string>();
const activeConversions = new Map<string, AbortController>();

function normalized(candidate: string): string {
  return path.resolve(candidate).toLocaleLowerCase();
}

function serializeDetection(result: PandocDetectionResult): PandocStatusRecord {
  if (result.installation) approvedExecutables.add(normalized(result.installation.executable));
  return {
    available: result.available,
    status: result.status,
    executablePath: result.installation?.executable,
    version: result.installation?.version,
    source: result.installation?.source,
    message: result.message,
    attempts: result.attempts.map((attempt) => ({
      path: attempt.executable,
      message: attempt.message,
      code: attempt.errorCode,
    })),
  };
}

function errorForRenderer(error: unknown): Error {
  if (error instanceof PandocError) {
    const details = error.details.stderr || error.details.stdout || '';
    return new Error(`${error.code}: ${error.message}${details ? `\n${details}` : ''}`);
  }
  if (error instanceof z.ZodError) {
    return new Error(`INVALID_ARGUMENT: ${error.issues.map((issue) => issue.message).join(' ')}`);
  }
  return error instanceof Error ? error : new Error('Pandoc conversion failed.');
}

function requireApproved(set: Set<string>, candidate: string, label: string): void {
  if (!set.has(normalized(candidate))) {
    throw new Error(`${label} was not selected through Markora's validated file picker.`);
  }
}

function conversionOptions(
  operationId: string,
  getWindow: () => BrowserWindow | null,
  controller: AbortController,
) {
  return {
    signal: controller.signal,
    timeoutMs: 120_000,
    maxOutputBytes: 2 * 1024 * 1024,
    onProgress: (progress: PandocProgress) => {
      getWindow()?.webContents.send('pandoc:progress', { operationId, ...progress });
    },
  };
}

async function withConversion<T>(operationId: string, action: (controller: AbortController) => Promise<T>) {
  if (activeConversions.has(operationId)) throw new Error('The Pandoc operation identifier is already active.');
  const controller = new AbortController();
  activeConversions.set(operationId, controller);
  try {
    return await action(controller);
  } finally {
    activeConversions.delete(operationId);
  }
}

async function removeTemp(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
}

export function registerPandocIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pandoc:detect', async (_event, manual: unknown) => {
    try {
      const candidate = manual === undefined ? undefined : executableSchema.parse(manual);
      if (candidate) requireApproved(approvedExecutables, candidate, 'Pandoc executable');
      return serializeDetection(await detectPandoc({ manualExecutable: candidate, timeoutMs: 10_000 }));
    } catch (error) {
      throw errorForRenderer(error);
    }
  });
  ipcMain.handle('pandoc:pickExecutable', async () => {
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Pandoc executable', extensions: ['exe'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const executable = selection.filePaths[0];
    approvedExecutables.add(normalized(executable));
    try {
      return serializeDetection(await detectPandoc({ manualExecutable: executable, timeoutMs: 10_000 }));
    } catch (error) {
      throw errorForRenderer(error);
    }
  });
  ipcMain.handle('pandoc:pickInput', async (_event, format: unknown) => {
    const parsed = importFormatSchema.parse(format);
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: `${parsed.toUpperCase()} document`, extensions: importExtensions[parsed] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    approvedInputs.add(normalized(selection.filePaths[0]));
    return { path: selection.filePaths[0], displayName: path.basename(selection.filePaths[0]) };
  });
  ipcMain.handle('pandoc:pickOutput', async (_event, payload: unknown) => {
    const request = z.object({ format: exportFormatSchema, title: z.string().max(500) }).parse(payload);
    const extension = exportExtensions[request.format];
    const printableTitle = Array.from(request.title)
      .map((character) => character.charCodeAt(0) < 32 ? '_' : character)
      .join('');
    const safeTitle = printableTitle.replace(/[<>:"/\\|?*]/g, '_').trim() || 'document';
    const selection = await dialog.showSaveDialog({
      defaultPath: `${safeTitle}.${extension}`,
      filters: [{ name: request.format.toUpperCase(), extensions: [extension] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    approvedOutputs.add(normalized(selection.filePath));
    return { path: selection.filePath, displayName: path.basename(selection.filePath) };
  });
  ipcMain.handle('pandoc:previewImport', async (_event, payload: unknown) => {
    try {
      const request = previewSchema.parse(payload);
      requireApproved(approvedExecutables, request.executablePath, 'Pandoc executable');
      requireApproved(approvedInputs, request.inputPath, 'Pandoc input');
      const tempDirectory = path.join(app.getPath('userData'), 'pandoc-temp');
      await fs.mkdir(tempDirectory, { recursive: true });
      const outputPath = path.join(tempDirectory, `${request.operationId}.md`);
      return await withConversion(request.operationId, async (controller) => {
        try {
          const result = await runPandocConversion(
            request.executablePath,
            { direction: 'import', inputPath: request.inputPath, outputPath, format: request.format },
            conversionOptions(request.operationId, getWindow, controller),
          );
          const markdown = await fs.readFile(outputPath, 'utf8');
          if (markdown.length > 20_000_000) throw new Error('Imported Markdown exceeds the 20 MB safety limit.');
          return {
            operationId: request.operationId,
            markdown,
            version: result.pandocVersion,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
          };
        } finally {
          await removeTemp(outputPath);
        }
      });
    } catch (error) {
      throw errorForRenderer(error);
    }
  });
  ipcMain.handle('pandoc:export', async (_event, payload: unknown) => {
    try {
      const request = exportSchema.parse(payload);
      requireApproved(approvedExecutables, request.executablePath, 'Pandoc executable');
      requireApproved(approvedOutputs, request.outputPath, 'Pandoc output');
      approvedOutputs.delete(normalized(request.outputPath));
      const tempDirectory = path.join(app.getPath('userData'), 'pandoc-temp');
      await fs.mkdir(tempDirectory, { recursive: true });
      const inputPath = path.join(tempDirectory, `${request.operationId}.md`);
      await fs.writeFile(inputPath, request.markdown, 'utf8');
      return await withConversion(request.operationId, async (controller) => {
        try {
          const result = await runPandocConversion(
            request.executablePath,
            {
              direction: 'export',
              inputPath,
              outputPath: request.outputPath,
              format: request.format,
              options: { standalone: true, metadata: request.metadata },
            },
            conversionOptions(request.operationId, getWindow, controller),
          );
          return {
            operationId: request.operationId,
            outputPath: result.outputPath,
            version: result.pandocVersion,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
          };
        } finally {
          await removeTemp(inputPath);
        }
      });
    } catch (error) {
      throw errorForRenderer(error);
    }
  });
  ipcMain.handle('pandoc:cancel', (_event, operation: unknown) => {
    const id = operationIdSchema.parse(operation);
    const controller = activeConversions.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  });
}
