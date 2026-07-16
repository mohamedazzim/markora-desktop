import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...arguments_: unknown[]) => unknown) => handlers.set(channel, handler)),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    once: vi.fn(),
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showSaveDialog: electronMocks.showSaveDialog,
  },
  app: { getPath: () => 'C:\\Markora-Test', once: electronMocks.once },
}));

import {
  recoveryIpcChannels,
  recoverySessionSchema,
  recoverySnapshotSchema,
  registerRecoveryIpc,
  saveFileRequestSchema,
} from '../../electron/main/recovery-ipc';
import {
  assertAuthorizedFile,
  assertAuthorizedWorkspace,
  authorizeFile,
  clearPathAuthorityForTests,
} from '../../electron/main/path-authority';

const { handlers, handle, showOpenDialog, showSaveDialog } = electronMocks;
let root = '';
let dispose: () => void;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-recovery-ipc-'));
  handlers.clear();
  handle.mockClear();
  showOpenDialog.mockReset();
  showSaveDialog.mockReset();
  clearPathAuthorityForTests();
  send = vi.fn();
  dispose = registerRecoveryIpc({
    getWindow: () => ({ webContents: { send } }) as never,
    userDataPath: () => root,
  });
});

afterEach(async () => {
  dispose();
  clearPathAuthorityForTests();
  await fs.rm(root, { recursive: true, force: true });
});

function handler(channel: string) {
  return handlers.get(channel)!;
}

describe('recovery IPC validation and file lifecycle', () => {
  it('registers all checked file, recovery, session, and observation channels', () => {
    expect(handle).toHaveBeenCalledTimes(Object.keys(recoveryIpcChannels).length - 2);
    expect(handlers.has(recoveryIpcChannels.saveChecked)).toBe(true);
    expect(handlers.has(recoveryIpcChannels.loadSession)).toBe(true);
  });

  it('strictly validates save, snapshot, and session payloads', () => {
    expect(() => saveFileRequestSchema.parse({ content: 'x', injected: true })).toThrow();
    expect(() => saveFileRequestSchema.parse({ content: 'x', overwrite: true })).toThrow(/confirmation/);
    expect(() => recoverySnapshotSchema.parse({ id: '../bad', content: 'x' })).toThrow();
    expect(() => recoverySessionSchema.parse({ documents: [], injected: true })).toThrow();
  });

  it('opens a native-dialog selection and returns a fingerprinted record', async () => {
    const target = path.join(root, 'opened.md');
    await fs.writeFile(target, '# open');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [target] });
    const record = await handler(recoveryIpcChannels.open)({});
    expect(record).toMatchObject({ path: target, content: '# open', fingerprint: { size: 6 } });
    expect(() => assertAuthorizedFile(target)).not.toThrow();
  });

  it('rejects renderer-supplied paths that were not user authorized', async () => {
    const target = path.join(root, 'private.md');
    await fs.writeFile(target, 'private');
    await expect(handler(recoveryIpcChannels.openPath)({}, target)).rejects.toThrow(/not selected/);
  });

  it('saves through optimistic version checks and retains backup metadata', async () => {
    const target = authorizeFile(path.join(root, 'save.md'));
    await fs.writeFile(target, 'opened');
    const opened = await handler(recoveryIpcChannels.openPath)({}, target) as { fingerprint: unknown };
    const result = await handler(recoveryIpcChannels.saveChecked)({}, {
      path: target,
      content: 'editor',
      expectedFingerprint: opened.fingerprint,
      documentId: 'save_doc',
      documentName: 'save.md',
    });
    expect(result).toMatchObject({ status: 'saved', backupPath: expect.stringContaining('backups') });
    expect(await fs.readFile(target, 'utf8')).toBe('editor');
  });

  it('returns a conflict, preserves newer disk text, and snapshots editor text', async () => {
    const target = authorizeFile(path.join(root, 'conflict.md'));
    await fs.writeFile(target, 'opened');
    const opened = await handler(recoveryIpcChannels.openPath)({}, target) as { fingerprint: unknown };
    await fs.writeFile(target, 'external');
    const result = await handler(recoveryIpcChannels.saveChecked)({}, {
      path: target,
      content: 'editor',
      expectedFingerprint: opened.fingerprint,
      documentId: 'conflict_doc',
      documentName: 'conflict.md',
    });
    expect(result).toMatchObject({ status: 'conflict', conflict: { kind: 'modified', disk: { content: 'external' } } });
    expect(await fs.readFile(target, 'utf8')).toBe('external');
    expect(await handler(recoveryIpcChannels.listRecoveries)({})).toMatchObject([
      { id: 'conflict_doc', content: 'editor', reason: 'conflict' },
    ]);
  });

  it('keeps legacy callers safe by throwing instead of silently overwriting', async () => {
    const target = authorizeFile(path.join(root, 'legacy.md'));
    await fs.writeFile(target, 'opened');
    await handler(recoveryIpcChannels.openPath)({}, target);
    await fs.writeFile(target, 'external');
    await expect(handler(recoveryIpcChannels.saveLegacy)({}, { path: target, content: 'editor' })).rejects.toThrow(/newer changes/);
    expect(await fs.readFile(target, 'utf8')).toBe('external');
  });

  it('treats the native Save As overwrite prompt as explicit confirmation', async () => {
    const target = path.join(root, 'save-as.md');
    await fs.writeFile(target, 'existing');
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const result = await handler(recoveryIpcChannels.saveChecked)({}, {
      content: 'replacement',
      documentName: 'save-as.md',
    });
    expect(result).toMatchObject({ status: 'saved', file: { path: target } });
    expect(await fs.readFile(target, 'utf8')).toBe('replacement');
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ properties: expect.arrayContaining(['showOverwriteConfirmation']) }));
  });

  it('returns null when Save As is cancelled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(handler(recoveryIpcChannels.saveChecked)({}, { content: 'text' })).resolves.toBeNull();
  });

  it('captures a write-failure snapshot and actionable failure code', async () => {
    const blocked = path.join(root, 'blocked');
    await fs.writeFile(blocked, 'not a folder');
    const target = authorizeFile(path.join(blocked, 'note.md'));
    const result = await handler(recoveryIpcChannels.saveChecked)({}, {
      path: target,
      content: 'protected editor text',
      documentId: 'failed_doc',
      documentName: 'note.md',
    });
    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'INVALID_DESTINATION', recoverySnapshotId: expect.any(String) },
    });
    expect(await handler(recoveryIpcChannels.listRecoveries)({})).toMatchObject([
      { id: 'failed_doc', content: 'protected editor text', reason: 'write-failure' },
    ]);
  });

  it('emits typed modification events and the compatibility record event', async () => {
    const target = authorizeFile(path.join(root, 'observed.md'));
    await fs.writeFile(target, 'one');
    await handler(recoveryIpcChannels.openPath)({}, target);
    await fs.writeFile(target, 'two');
    const event = await handler(recoveryIpcChannels.checkExternal)({}, target);
    expect(event).toMatchObject({ kind: 'modified', record: { content: 'two' } });
    expect(send).toHaveBeenCalledWith(recoveryIpcChannels.externalChanged, expect.objectContaining({ kind: 'modified' }));
    expect(send).toHaveBeenCalledWith(recoveryIpcChannels.externalChangedLegacy, expect.objectContaining({ content: 'two' }));
  });

  it('detects and authorizes a same-directory renamed path', async () => {
    const target = authorizeFile(path.join(root, 'before.md'));
    const renamed = path.join(root, 'after.md');
    await fs.writeFile(target, 'same');
    await handler(recoveryIpcChannels.openPath)({}, target);
    await fs.rename(target, renamed);
    expect(await handler(recoveryIpcChannels.checkExternal)({}, target)).toMatchObject({ kind: 'renamed', renamedPath: renamed });
    await expect(handler(recoveryIpcChannels.openPath)({}, renamed)).resolves.toMatchObject({ content: 'same' });
  });

  it('persists history and authorizes validated session paths on restoration', async () => {
    const target = path.join(root, 'session.md');
    await fs.writeFile(target, 'saved');
    await handler(recoveryIpcChannels.saveRecovery)({}, { id: 'session_doc', path: target, content: 'unsaved' });
    expect(await handler(recoveryIpcChannels.history)({}, 'session_doc')).toHaveLength(1);
    await handler(recoveryIpcChannels.saveSession)({}, {
      workspacePath: root,
      documents: [{ id: 'session_doc', path: target, name: 'session.md', mode: 'source', active: true }],
    });
    expect(await handler(recoveryIpcChannels.loadSession)({})).toMatchObject({ version: 1, documents: [{ id: 'session_doc' }] });
    expect(() => assertAuthorizedFile(target)).not.toThrow();
    expect(() => assertAuthorizedWorkspace(root)).not.toThrow();
    await handler(recoveryIpcChannels.clearRecovery)({}, 'session_doc');
    expect(await handler(recoveryIpcChannels.listRecoveries)({})).toEqual([]);
  });
});
