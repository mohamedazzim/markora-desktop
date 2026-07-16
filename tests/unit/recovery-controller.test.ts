import { describe, expect, it, vi } from 'vitest';
import type {
  FileRecord,
  RecoverySessionRecord,
  RecoverySnapshotRecord,
  SaveFileResult,
} from '../../src/shared/contracts';
import {
  createRestorePlan,
  RecoveryController,
  type RecoverableDocument,
  type RecoveryApi,
} from '../../src/renderer/recovery/recovery-controller';

const fingerprint = { modifiedAt: 10, size: 4, sha256: 'a'.repeat(64) };
const newerFingerprint = { modifiedAt: 20, size: 5, sha256: 'b'.repeat(64) };
const file: FileRecord = {
  path: 'C:\\notes\\one.md',
  name: 'one.md',
  content: 'disk',
  lineEnding: 'LF',
  modifiedAt: 10,
  fingerprint,
};
const document: RecoverableDocument = {
  id: 'doc_1',
  path: file.path,
  name: file.name,
  content: 'editor',
  lineEnding: 'LF',
  mode: 'source',
  active: true,
  dirty: true,
};

function snapshot(id = 'doc_1'): RecoverySnapshotRecord {
  return {
    version: 1,
    snapshotId: 'snapshot-1',
    id,
    path: file.path,
    name: file.name,
    content: 'recovered',
    lineEnding: 'LF',
    reason: 'autosave',
    createdAt: 1,
    updatedAt: 2,
  };
}

function api(overrides: Partial<RecoveryApi> = {}): RecoveryApi {
  return {
    saveFileChecked: vi.fn(async () => ({ status: 'saved', file }) as SaveFileResult),
    acceptDiskVersion: vi.fn(async () => undefined),
    unwatchFile: vi.fn(async () => undefined),
    openPath: vi.fn(async () => file),
    saveRecovery: vi.fn(async () => snapshot()),
    getRecoveries: vi.fn(async () => []),
    clearRecovery: vi.fn(async () => undefined),
    saveRecoverySession: vi.fn(async () => undefined),
    loadRecoverySession: vi.fn(async () => null),
    ...overrides,
  };
}

describe('recovery restore planning', () => {
  it('overlays unsaved snapshots onto the matching session tabs', () => {
    const session: RecoverySessionRecord = {
      version: 1,
      savedAt: 100,
      documents: [
        { id: 'doc_1', path: file.path, name: file.name, mode: 'structured', active: true },
        { id: 'doc_2', path: 'C:\\notes\\two.md', name: 'two.md', mode: 'source', active: false },
      ],
    };
    expect(createRestorePlan(session, [snapshot()])).toMatchObject([
      { id: 'doc_1', source: 'snapshot', mode: 'structured', active: true },
      { id: 'doc_2', source: 'disk', mode: 'source', active: false },
    ]);
  });

  it('retains orphan snapshots and chooses an active item', () => {
    const plan = createRestorePlan(null, [snapshot('orphan')]);
    expect(plan).toMatchObject([{ id: 'orphan', source: 'snapshot', active: true }]);
  });
});

describe('RecoveryController', () => {
  it('includes the remembered disk fingerprint in normal saves', async () => {
    const mock = api();
    const controller = new RecoveryController(mock);
    controller.rememberFile(file);
    await controller.save(document);
    expect(mock.saveFileChecked).toHaveBeenCalledWith(expect.objectContaining({
      path: file.path,
      expectedFingerprint: fingerprint,
      createBackup: true,
      documentId: document.id,
    }));
  });

  it('omits the path and fingerprint for Save As', async () => {
    const savedCopy = { ...file, path: 'C:\\notes\\copy.md', name: 'copy.md' };
    const mock = api({
      saveFileChecked: vi.fn(async () => ({ status: 'saved' as const, file: savedCopy })),
    });
    const controller = new RecoveryController(mock);
    controller.rememberFile(file);
    await controller.save(document, true);
    expect(mock.saveFileChecked).toHaveBeenCalledWith(expect.objectContaining({ path: undefined, expectedFingerprint: undefined }));
    expect(mock.unwatchFile).toHaveBeenCalledWith(file.path);
  });

  it('reloads and accepts a newer disk version', async () => {
    const disk = { ...file, content: 'newer', fingerprint: newerFingerprint };
    const mock = api();
    const controller = new RecoveryController(mock);
    const result = await controller.resolveConflict({
      document,
      result: { status: 'conflict', conflict: { kind: 'modified', path: file.path, expected: fingerprint, actual: newerFingerprint, disk } },
    }, 'reload');
    expect(result).toMatchObject({ action: 'reload', file: disk });
    expect(mock.acceptDiskVersion).toHaveBeenCalledWith({ path: file.path, fingerprint: newerFingerprint });
    expect(mock.clearRecovery).toHaveBeenCalledWith(document.id);
  });

  it('keeps editor text by writing a conflict recovery snapshot', async () => {
    const mock = api();
    const controller = new RecoveryController(mock);
    const result = await controller.resolveConflict({
      document,
      result: { status: 'conflict', conflict: { kind: 'deleted', path: file.path, expected: fingerprint, actual: null } },
    }, 'keep');
    expect(result.action).toBe('keep');
    expect(mock.saveRecovery).toHaveBeenCalledWith(expect.objectContaining({ content: 'editor', reason: 'conflict' }));
  });

  it('moves file observation to an explicitly accepted renamed path', async () => {
    const renamed = { ...file, path: 'C:\\notes\\renamed.md', name: 'renamed.md' };
    const mock = api();
    const controller = new RecoveryController(mock);
    await controller.resolveConflict({
      document,
      result: {
        status: 'conflict',
        conflict: {
          kind: 'renamed',
          path: file.path,
          renamedPath: renamed.path,
          expected: fingerprint,
          actual: fingerprint,
          disk: renamed,
        },
      },
    }, 'reload');
    expect(mock.unwatchFile).toHaveBeenCalledWith(file.path);
    expect(mock.acceptDiskVersion).toHaveBeenCalledWith({ path: renamed.path, fingerprint });
  });

  it('saves a copy through the native path chooser without overwriting', async () => {
    const mock = api();
    const controller = new RecoveryController(mock);
    const conflict = { document, result: { status: 'conflict' as const, conflict: { kind: 'modified' as const, path: file.path, expected: fingerprint, actual: newerFingerprint } } };
    expect((await controller.resolveConflict(conflict, 'save-copy')).action).toBe('saved');
    expect(mock.saveFileChecked).toHaveBeenCalledWith(expect.objectContaining({ path: undefined, overwrite: false }));
  });

  it('sets both confirmation flags for an explicit overwrite', async () => {
    const mock = api();
    const controller = new RecoveryController(mock);
    const conflict = { document, result: { status: 'conflict' as const, conflict: { kind: 'modified' as const, path: file.path, expected: fingerprint, actual: newerFingerprint } } };
    await controller.resolveConflict(conflict, 'overwrite');
    expect(mock.saveFileChecked).toHaveBeenCalledWith(expect.objectContaining({
      path: file.path,
      overwrite: true,
      overwriteConfirmed: true,
      createBackup: true,
    }));
  });

  it('overwrites the detected renamed file and releases the obsolete watcher', async () => {
    const renamedPath = 'C:\\notes\\renamed.md';
    const renamedFile = { ...file, path: renamedPath, name: 'renamed.md' };
    const mock = api({
      saveFileChecked: vi.fn(async () => ({ status: 'saved' as const, file: renamedFile })),
    });
    const controller = new RecoveryController(mock);
    await controller.resolveConflict({
      document,
      result: {
        status: 'conflict',
        conflict: {
          kind: 'renamed',
          path: file.path,
          renamedPath,
          expected: fingerprint,
          actual: newerFingerprint,
        },
      },
    }, 'overwrite');
    expect(mock.saveFileChecked).toHaveBeenCalledWith(expect.objectContaining({ path: renamedPath }));
    expect(mock.unwatchFile).toHaveBeenCalledWith(file.path);
  });

  it('returns cancelled when the Save a Copy dialog is cancelled', async () => {
    const mock = api({ saveFileChecked: vi.fn(async () => null) });
    const controller = new RecoveryController(mock);
    const conflict = { document, result: { status: 'conflict' as const, conflict: { kind: 'deleted' as const, path: file.path, expected: fingerprint, actual: null } } };
    expect(await controller.resolveConflict(conflict, 'save-copy')).toEqual({ action: 'cancelled' });
  });

  it('persists dirty snapshots before the versioned session record', async () => {
    const calls: string[] = [];
    const mock = api({
      saveRecovery: vi.fn(async () => { calls.push('snapshot'); return snapshot(); }),
      saveRecoverySession: vi.fn(async () => { calls.push('session'); }),
    });
    const controller = new RecoveryController(mock);
    await controller.persistSession([document, { ...document, id: 'clean', dirty: false, active: false }], 'C:\\notes', 'shutdown');
    expect(calls).toEqual(['snapshot', 'session']);
    expect(mock.saveRecovery).toHaveBeenCalledTimes(1);
    expect(mock.saveRecoverySession).toHaveBeenCalledWith(expect.objectContaining({ documents: expect.arrayContaining([expect.objectContaining({ id: 'clean' })]) }));
  });

  it('loads session and recovery metadata together', async () => {
    const mock = api({
      loadRecoverySession: vi.fn(async () => ({ version: 1 as const, savedAt: 1, documents: [] })),
      getRecoveries: vi.fn(async () => [snapshot('restored')]),
    });
    expect(await new RecoveryController(mock).loadRestorePlan()).toMatchObject([{ id: 'restored', source: 'snapshot' }]);
  });

  it('restores snapshot text locally or opens a saved session file', async () => {
    const mock = api();
    const controller = new RecoveryController(mock);
    const stored = snapshot();
    await expect(controller.restore({ id: 'doc_1', name: file.name, mode: 'source', active: true, source: 'snapshot', snapshot: stored })).resolves.toBe(stored);
    await expect(controller.restore({ id: 'doc_2', path: file.path, name: file.name, mode: 'source', active: false, source: 'disk' })).resolves.toBe(file);
    expect(mock.openPath).toHaveBeenCalledWith(file.path);
  });

  it('converts external rename metadata into the same conflict workflow', () => {
    const controller = new RecoveryController(api());
    expect(controller.externalConflict({
      kind: 'renamed',
      path: file.path,
      renamedPath: 'C:\\notes\\renamed.md',
      previousFingerprint: fingerprint,
      fingerprint: newerFingerprint,
      observedAt: 1,
    }, document)).toMatchObject({ result: { conflict: { kind: 'renamed', renamedPath: 'C:\\notes\\renamed.md' } } });
  });
});
