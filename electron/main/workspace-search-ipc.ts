import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { assertAuthorizedWorkspace } from './path-authority';
import type {
  WorkspaceSearchWorkerRequest,
  WorkspaceSearchWorkerResponse,
} from './workspace-search';

const operationId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
const idList = z.array(z.string().min(1).max(200)).max(100_000).optional();
const searchSchema = z.object({
  workspaceRoot: z.string().min(1).max(32_000),
  query: z.string().min(1).max(2_000),
  scope: z.enum(['filename', 'content', 'both']).optional(),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  wholeWord: z.boolean().optional(),
  includeGlobs: z.array(z.string().min(1).max(500)).max(100).optional(),
  excludeGlobs: z.array(z.string().min(1).max(500)).max(100).optional(),
  respectGitignore: z.boolean().optional(),
  ignoredDirectories: z.array(z.string().min(1).max(260)).max(100).optional(),
}).strict();
const searchPayload = z.object({ operationId, search: searchSchema });
const previewPayload = z.object({
  operationId,
  search: searchSchema,
  replacement: z.string().max(1_000_000),
  selection: z.object({
    includeFileIds: idList,
    includeMatchIds: idList,
    excludeMatchIds: idList,
  }).optional(),
});
const applyPayload = z.object({
  operationId,
  previewToken: z.string().min(10).max(500),
  confirmationToken: z.string().min(10).max(500),
  confirmed: z.boolean(),
  createBackups: z.literal(true),
});
const discardPayload = z.object({
  operationId,
  previewToken: z.string().min(10).max(500),
});

interface PendingOperation {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export function registerWorkspaceSearchIpc(getWindow: () => BrowserWindow | null): void {
  let worker: Worker | null = null;
  const pending = new Map<string, PendingOperation>();

  const rejectPending = (message: string) => {
    for (const operation of pending.values()) operation.reject(new Error(message));
    pending.clear();
  };
  const ensureWorker = () => {
    if (worker) return worker;
    worker = new Worker(path.join(__dirname, 'workspace-search-worker.js'));
    worker.on('message', (response: WorkspaceSearchWorkerResponse) => {
      if (response.kind === 'progress') {
        getWindow()?.webContents.send('workspace:searchProgress', {
          operationId: response.operationId,
          ...response.progress,
        });
        return;
      }
      const operation = pending.get(response.operationId);
      if (!operation) return;
      pending.delete(response.operationId);
      if (response.kind === 'result') operation.resolve(response.result);
      else operation.reject(new Error(String(response.error.message || 'Workspace operation failed.')));
    });
    worker.on('error', (error) => {
      rejectPending(`Workspace search worker failed: ${error.message}`);
      worker = null;
    });
    worker.on('exit', (code) => {
      if (code !== 0) rejectPending(`Workspace search worker exited with code ${code}.`);
      worker = null;
    });
    return worker;
  };
  const requestWorker = (request: WorkspaceSearchWorkerRequest): Promise<unknown> => {
    if (pending.has(request.operationId)) {
      return Promise.reject(new Error('The workspace operation identifier is already active.'));
    }
    return new Promise((resolve, reject) => {
      pending.set(request.operationId, { resolve, reject });
      ensureWorker().postMessage(request);
    });
  };

  ipcMain.handle('workspace:advancedSearch', async (_event, payload: unknown) => {
    const request = searchPayload.parse(payload);
    assertAuthorizedWorkspace(request.search.workspaceRoot);
    return requestWorker({ kind: 'search', operationId: request.operationId, request: request.search });
  });
  ipcMain.handle('workspace:replacePreview', async (_event, payload: unknown) => {
    const request = previewPayload.parse(payload);
    assertAuthorizedWorkspace(request.search.workspaceRoot);
    return requestWorker({
      kind: 'preview',
      operationId: request.operationId,
      request: {
        search: request.search,
        replacement: request.replacement,
        selection: request.selection,
      },
    });
  });
  ipcMain.handle('workspace:replaceApply', async (_event, payload: unknown) => {
    const request = applyPayload.parse(payload);
    return requestWorker({
      kind: 'apply',
      operationId: request.operationId,
      request: {
        previewToken: request.previewToken,
        confirmationToken: request.confirmationToken,
        confirmed: request.confirmed,
        createBackups: request.createBackups,
      },
    });
  });
  ipcMain.handle('workspace:replaceDiscard', async (_event, payload: unknown) => {
    const request = discardPayload.parse(payload);
    return requestWorker({
      kind: 'discard-preview',
      operationId: request.operationId,
      previewToken: request.previewToken,
    });
  });
  ipcMain.handle('workspace:operationCancel', (_event, candidate: unknown) => {
    const id = operationId.parse(candidate);
    ensureWorker().postMessage({ kind: 'cancel', operationId: id } satisfies WorkspaceSearchWorkerRequest);
  });
  app.on('before-quit', () => {
    if (worker) void worker.terminate();
    worker = null;
  });
}
