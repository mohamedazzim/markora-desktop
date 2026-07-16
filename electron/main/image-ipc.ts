import { clipboard, dialog, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import type { ImageAssetImportRequest } from '../../src/shared/contracts';
import {
  AssetOperationError,
  copyLocalImageAsset,
  downloadRemoteImageAsset,
  resolveLocalImageReference,
  writeClipboardImageAsset,
} from './image-assets';
import {
  assertAuthorizedAsset,
  assertAuthorizedFile,
  assertAuthorizedWorkspace,
  authorizeAsset,
} from './path-authority';

const absolutePath = z.string().min(1).max(32_000).refine(
  (value) => path.isAbsolute(value) && !value.includes('\0'),
  'An absolute path without null characters is required.',
);
const optionalAbsolutePath = absolutePath.optional();
const operationId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const contextSchema = z.object({
  documentPath: optionalAbsolutePath,
  workspaceRoot: optionalAbsolutePath,
  workspaceAssetDirectoryName: z.string().min(1).max(100).optional(),
});
const commonSchema = z.object({
  operationId,
  strategy: z.enum([
    'keep-original',
    'document-sibling',
    'assets',
    'document-assets',
    'workspace-assets',
    'date-based',
  ]),
  filename: z.string().max(255),
  context: contextSchema,
  conflictPolicy: z.enum(['rename', 'error', 'overwrite']).optional(),
  markdownPathPreference: z
    .enum(['auto', 'document-relative', 'workspace-relative', 'absolute'])
    .optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  maxBytes: z.number().int().min(1).max(1024 * 1024 * 1024).optional(),
});
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: absolutePath }),
  z.object({
    kind: z.literal('clipboard'),
    data: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
    mimeType: z.string().regex(/^image\/[a-z0-9.+-]+$/i).max(100),
  }),
  z.object({ kind: z.literal('remote'), url: z.string().url().max(8_000) }),
]);
const importSchema = commonSchema.extend({ source: sourceSchema });
const resolveSchema = z.object({
  reference: z.string().min(1).max(32_000),
  documentPath: optionalAbsolutePath,
  workspaceRoot: optionalAbsolutePath,
});

const activeOperations = new Map<string, AbortController>();

function actionableError(error: unknown): Error {
  if (error instanceof AssetOperationError) {
    const result = new Error(`${error.code}: ${error.message}`);
    result.name = 'ImageAssetError';
    return result;
  }
  if (error instanceof z.ZodError) {
    return new Error(`INVALID_ARGUMENT: ${error.issues.map((issue) => issue.message).join(' ')}`);
  }
  return error instanceof Error ? error : new Error('The image operation failed.');
}

async function importImage(payload: unknown) {
  const request = importSchema.parse(payload) as ImageAssetImportRequest;
  if (request.context.documentPath) assertAuthorizedFile(request.context.documentPath);
  if (request.context.workspaceRoot) assertAuthorizedWorkspace(request.context.workspaceRoot);
  if (request.source.kind === 'local') assertAuthorizedAsset(request.source.path);
  if (activeOperations.has(request.operationId)) {
    throw new Error('INVALID_ARGUMENT: The image operation identifier is already active.');
  }
  const controller = new AbortController();
  activeOperations.set(request.operationId, controller);
  const common = {
    strategy: request.strategy,
    filename: request.filename,
    context: request.context,
    conflictPolicy: request.conflictPolicy,
    markdownPathPreference: request.markdownPathPreference,
  };
  try {
    if (request.source.kind === 'local') {
      const result = await copyLocalImageAsset({ ...common, sourcePath: request.source.path });
      authorizeAsset(result.assetPath);
      return result;
    }
    if (request.source.kind === 'clipboard') {
      const result = await writeClipboardImageAsset({
        ...common,
        data: request.source.data,
        mimeType: request.source.mimeType,
        maxBytes: request.maxBytes,
      });
      authorizeAsset(result.assetPath);
      return result;
    }
    const result = await downloadRemoteImageAsset({
      ...common,
      url: request.source.url,
      timeoutMs: request.timeoutMs,
      maxBytes: request.maxBytes,
      signal: controller.signal,
    });
    authorizeAsset(result.assetPath);
    return result;
  } finally {
    activeOperations.delete(request.operationId);
  }
}

/** Registers the typed and validated image-only privileged boundary. */
export function registerImageIpc(): void {
  ipcMain.handle('image:pick', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'tif', 'tiff', 'ico'],
        },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = authorizeAsset(result.filePaths[0]);
    return { path: selected, displayName: path.basename(selected) };
  });
  ipcMain.handle('image:import', async (_event, payload: unknown) => {
    try {
      return await importImage(payload);
    } catch (error) {
      throw actionableError(error);
    }
  });
  ipcMain.handle('image:cancel', (_event, id: unknown) => {
    const parsed = operationId.parse(id);
    const controller = activeOperations.get(parsed);
    if (!controller) return false;
    controller.abort();
    return true;
  });
  ipcMain.handle('image:resolve', async (_event, payload: unknown) => {
    try {
      const request = resolveSchema.parse(payload);
      if (request.documentPath) assertAuthorizedFile(request.documentPath);
      if (request.workspaceRoot) assertAuthorizedWorkspace(request.workspaceRoot);
      const resolved = await resolveLocalImageReference(request);
      authorizeAsset(resolved);
      return resolved;
    } catch (error) {
      throw actionableError(error);
    }
  });
  ipcMain.handle('image:copy', async (_event, candidate: unknown) => {
    const imagePath = absolutePath.parse(candidate);
    assertAuthorizedAsset(imagePath);
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) throw new Error('BROKEN_LOCAL_REFERENCE: The image could not be read.');
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle('shell:openPath', async (_event, candidate: unknown) => {
    const itemPath = absolutePath.parse(candidate);
    assertAuthorizedAsset(itemPath);
    return (await shell.openPath(itemPath)) === '';
  });
}
