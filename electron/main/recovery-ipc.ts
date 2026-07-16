import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import type {
  RecoverySessionRecord,
  RecoverySnapshotRecord,
  SaveFileRequest,
  SaveFileResult,
} from '../../src/shared/contracts';
import { FileRecoveryService } from './file-recovery-service';
import {
  assertAuthorizedFile,
  authorizeFile,
  authorizeWorkspace,
} from './path-authority';
import { RecoveryStore } from './recovery-store';

export const recoveryIpcChannels = {
  open: 'file:open',
  openPath: 'file:openPath',
  saveLegacy: 'file:save',
  saveChecked: 'file:saveChecked',
  acceptDiskVersion: 'file:acceptDiskVersion',
  unwatch: 'file:unwatch',
  checkExternal: 'file:checkExternal',
  externalChanged: 'file:externalChanged',
  externalChangedLegacy: 'file:changed',
  saveRecovery: 'recovery:save',
  listRecoveries: 'recovery:list',
  history: 'recovery:history',
  clearRecovery: 'recovery:clear',
  saveSession: 'recovery:sessionSave',
  loadSession: 'recovery:sessionLoad',
} as const;

const fingerprintSchema = z
  .object({
    modifiedAt: z.number().finite().nonnegative(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const saveFileRequestSchema = z
  .object({
    path: z.string().min(1).max(32_767).optional(),
    content: z.string().max(25_000_000),
    expectedFingerprint: fingerprintSchema.optional(),
    overwrite: z.boolean().optional(),
    overwriteConfirmed: z.boolean().optional(),
    createBackup: z.boolean().optional(),
    documentId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u).optional(),
    documentName: z.string().max(512).optional(),
    lineEnding: z.enum(['LF', 'CRLF']).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.overwrite && !value.overwriteConfirmed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['overwriteConfirmed'],
        message: 'Explicit overwrite confirmation is required.',
      });
    }
  });

export const recoverySnapshotSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u),
    path: z.string().min(1).max(32_767).optional(),
    name: z.string().max(512).optional(),
    content: z.string().max(25_000_000),
    lineEnding: z.enum(['LF', 'CRLF']).optional(),
    reason: z.enum(['autosave', 'shutdown', 'conflict', 'write-failure']).optional(),
  })
  .strict();

const sessionDocumentSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u),
    path: z.string().min(1).max(32_767).optional(),
    name: z.string().min(1).max(512),
    mode: z.enum(['source', 'structured']),
    active: z.boolean(),
  })
  .strict();

export const recoverySessionSchema = z
  .object({
    workspacePath: z.string().min(1).max(32_767).optional(),
    documents: z.array(sessionDocumentSchema).max(100),
  })
  .strict();

function conflictMessage(result: Extract<SaveFileResult, { status: 'conflict' }>): string {
  switch (result.conflict.kind) {
    case 'modified':
      return 'Save stopped because the file contains newer changes from another application.';
    case 'deleted':
      return 'Save stopped because the file was deleted from disk.';
    case 'renamed':
      return `Save stopped because the file was renamed to ${result.conflict.renamedPath ?? 'another path'}.`;
    case 'destination-exists':
      return 'Save stopped because the destination already exists and overwrite was not confirmed.';
  }
}

export interface RecoveryIpcRegistrationOptions {
  readonly getWindow: () => BrowserWindow | null;
  /** Tests may inject stable roots without initializing Electron's app lifecycle. */
  readonly userDataPath?: () => string;
}

export function registerRecoveryIpc(options: RecoveryIpcRegistrationOptions): () => void {
  let recoveryStore: RecoveryStore | undefined;
  let fileService: FileRecoveryService | undefined;
  const userData = options.userDataPath ?? (() => app.getPath('userData'));

  const store = (): RecoveryStore => {
    recoveryStore ??= new RecoveryStore(path.join(userData(), 'recovery'), {
      maximumSnapshotsPerDocument: 10,
      maximumContentBytes: 25_000_000,
    });
    return recoveryStore;
  };
  const service = (): FileRecoveryService => {
    fileService ??= new FileRecoveryService({
      backupRoot: path.join(userData(), 'backups'),
      onExternalChange: (event) => {
        if (event.kind === 'renamed' && event.renamedPath) authorizeFile(event.renamedPath);
        options.getWindow()?.webContents.send(recoveryIpcChannels.externalChanged, event);
        if (event.kind === 'modified' && event.record) {
          options.getWindow()?.webContents.send(
            recoveryIpcChannels.externalChangedLegacy,
            event.record,
          );
        }
      },
    });
    return fileService;
  };

  const performSave = async (payload: unknown): Promise<SaveFileResult | null> => {
    const request = saveFileRequestSchema.parse(payload) as SaveFileRequest;
    let target = request.path;
    let nativeOverwriteConfirmation = false;
    if (target) {
      assertAuthorizedFile(target);
    } else {
      const selection = await dialog.showSaveDialog({
        title: 'Save Markdown document',
        defaultPath: request.documentName || 'Untitled.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (selection.canceled || !selection.filePath) return null;
      target = authorizeFile(selection.filePath);
      nativeOverwriteConfirmation = true;
    }

    const result = await service().save({
      ...request,
      path: target,
      overwrite: request.overwrite || nativeOverwriteConfirmation,
      overwriteConfirmed: request.overwriteConfirmed || nativeOverwriteConfirmation,
    });
    if ((result.status === 'failed' || result.status === 'conflict') && request.documentId) {
      try {
        const snapshot = await store().saveSnapshot({
          id: request.documentId,
          path: target,
          name: request.documentName,
          content: request.content,
          lineEnding: request.lineEnding,
          reason: result.status === 'conflict' ? 'conflict' : 'write-failure',
        });
        if (result.status === 'failed') result.failure.recoverySnapshotId = snapshot.snapshotId;
      } catch {
        // Return the original write result; recovery failure must not obscure it.
      }
    }
    return result;
  };

  ipcMain.handle(recoveryIpcChannels.open, async () => {
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    return service().open(authorizeFile(selection.filePaths[0]));
  });
  ipcMain.handle(recoveryIpcChannels.openPath, async (_event, candidate: unknown) => {
    const filePath = z.string().min(1).max(32_767).parse(candidate);
    assertAuthorizedFile(filePath);
    return service().open(filePath);
  });
  ipcMain.handle(recoveryIpcChannels.saveChecked, (_event, payload: unknown) => performSave(payload));
  ipcMain.handle(recoveryIpcChannels.saveLegacy, async (_event, payload: unknown) => {
    const result = await performSave(payload);
    if (!result) return null;
    if (result.status === 'saved') return result.file;
    if (result.status === 'conflict') {
      const error = new Error(conflictMessage(result));
      error.name = 'DiskConflictError';
      throw error;
    }
    const error = new Error(result.failure.message);
    error.name = result.failure.code;
    throw error;
  });
  ipcMain.handle(recoveryIpcChannels.acceptDiskVersion, (_event, payload: unknown) => {
    const request = z
      .object({ path: z.string().min(1).max(32_767), fingerprint: fingerprintSchema })
      .strict()
      .parse(payload);
    assertAuthorizedFile(request.path);
    service().acceptDiskVersion(request.path, request.fingerprint);
  });
  ipcMain.handle(recoveryIpcChannels.unwatch, (_event, candidate: unknown) => {
    const filePath = z.string().min(1).max(32_767).parse(candidate);
    assertAuthorizedFile(filePath);
    service().untrack(filePath);
  });
  ipcMain.handle(recoveryIpcChannels.checkExternal, (_event, candidate: unknown) => {
    const filePath = z.string().min(1).max(32_767).parse(candidate);
    assertAuthorizedFile(filePath);
    return service().checkForExternalChange(filePath);
  });
  ipcMain.handle(recoveryIpcChannels.saveRecovery, async (_event, payload: unknown) => {
    const request = recoverySnapshotSchema.parse(payload);
    return store().saveSnapshot(request) as Promise<RecoverySnapshotRecord>;
  });
  ipcMain.handle(recoveryIpcChannels.listRecoveries, async () => {
    const snapshots = (await store().listLatest()) as RecoverySnapshotRecord[];
    for (const snapshot of snapshots) {
      if (snapshot.path) authorizeFile(snapshot.path);
    }
    return snapshots;
  });
  ipcMain.handle(recoveryIpcChannels.history, (_event, candidate: unknown) =>
    store().listHistory(z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u).parse(candidate)) as Promise<
      RecoverySnapshotRecord[]
    >,
  );
  ipcMain.handle(recoveryIpcChannels.clearRecovery, (_event, candidate: unknown) =>
    store().clear(z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u).parse(candidate)),
  );
  ipcMain.handle(recoveryIpcChannels.saveSession, (_event, payload: unknown) =>
    store().saveSession(recoverySessionSchema.parse(payload)),
  );
  ipcMain.handle(recoveryIpcChannels.loadSession, async () => {
    const session = (await store().loadSession()) as RecoverySessionRecord | null;
    if (!session) return null;
    if (session.workspacePath) authorizeWorkspace(session.workspacePath);
    for (const document of session.documents) {
      if (document.path) authorizeFile(document.path);
    }
    return session;
  });

  const dispose = (): void => {
    fileService?.close();
    fileService = undefined;
  };
  app.once('before-quit', dispose);
  return dispose;
}
