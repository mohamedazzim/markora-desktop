import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SaveFileRequest, SaveFileResult } from '../../src/shared/contracts';
import { FileRecoveryService, readMarkdownFileRecord } from '../../electron/main/file-recovery-service';
import { RecoveryStore } from '../../electron/main/recovery-store';

let root = '';
let service: FileRecoveryService;
let store: RecoveryStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-recovery-integration-'));
  service = new FileRecoveryService({ backupRoot: path.join(root, 'app-data', 'backups') });
  store = new RecoveryStore(path.join(root, 'app-data', 'recovery'));
});

afterEach(async () => {
  service.close();
  await fs.rm(root, { recursive: true, force: true });
});

async function checkedSave(request: SaveFileRequest & { path: string }): Promise<SaveFileResult> {
  const result = await service.save(request);
  if ((result.status === 'conflict' || result.status === 'failed') && request.documentId) {
    await store.saveSnapshot({
      id: request.documentId,
      path: request.path,
      name: request.documentName,
      content: request.content,
      lineEnding: request.lineEnding,
      reason: result.status === 'conflict' ? 'conflict' : 'write-failure',
    });
  }
  return result;
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for filesystem observation.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('recovery, conflict, and session integration', () => {
  it('protects editor and disk versions across conflict, recovery, and confirmed overwrite', async () => {
    const target = path.join(root, 'journey.md');
    await fs.writeFile(target, 'opened disk');
    const opened = await service.open(target);
    await fs.writeFile(target, 'newer external disk');

    const conflict = await checkedSave({
      path: target,
      content: 'unsaved editor',
      expectedFingerprint: opened.fingerprint,
      documentId: 'journey_doc',
      documentName: 'journey.md',
      lineEnding: 'LF',
    });
    expect(conflict).toMatchObject({ status: 'conflict', conflict: { kind: 'modified' } });
    expect(await fs.readFile(target, 'utf8')).toBe('newer external disk');
    expect(await store.listLatest()).toMatchObject([{ content: 'unsaved editor', reason: 'conflict' }]);

    const overwrite = await checkedSave({
      path: target,
      content: 'unsaved editor',
      expectedFingerprint: opened.fingerprint,
      overwrite: true,
      overwriteConfirmed: true,
      documentId: 'journey_doc',
    });
    expect(overwrite.status).toBe('saved');
    if (overwrite.status === 'saved') {
      expect(await fs.readFile(overwrite.backupPath!, 'utf8')).toBe('newer external disk');
    }
    expect(await fs.readFile(target, 'utf8')).toBe('unsaved editor');
  });

  it('restores unsaved and saved tabs from a persisted versioned session', async () => {
    const savedPath = path.join(root, 'saved.md');
    await fs.writeFile(savedPath, 'saved disk');
    await store.saveSnapshot({ id: 'dirty', name: 'Untitled.md', content: 'unsaved text' });
    await store.saveSession({
      workspacePath: root,
      documents: [
        { id: 'saved', path: savedPath, name: 'saved.md', mode: 'structured', active: false },
        { id: 'dirty', name: 'Untitled.md', mode: 'source', active: true },
      ],
    });

    const afterRelaunch = new RecoveryStore(path.join(root, 'app-data', 'recovery'));
    expect(await afterRelaunch.loadSession()).toMatchObject({
      version: 1,
      workspacePath: root,
      documents: [{ id: 'saved' }, { id: 'dirty', active: true }],
    });
    expect(await afterRelaunch.listLatest()).toMatchObject([{ id: 'dirty', content: 'unsaved text' }]);
    expect((await service.open(savedPath)).content).toBe('saved disk');
  });

  it('surfaces modified, renamed, and deleted disk events', async () => {
    const events: string[] = [];
    service.close();
    service = new FileRecoveryService({
      backupRoot: path.join(root, 'backups-events'),
      watcherDebounceMs: 10,
      onExternalChange: (event) => events.push(event.kind),
    });
    const modifiedPath = path.join(root, 'modified.md');
    await fs.writeFile(modifiedPath, 'one');
    await service.open(modifiedPath);
    await fs.writeFile(modifiedPath, 'two');
    await waitFor(() => events.includes('modified'));
    const accepted = await readMarkdownFileRecord(modifiedPath);
    service.acceptDiskVersion(modifiedPath, accepted.fingerprint!);

    const renamedPath = path.join(root, 'renamed.md');
    await fs.rename(modifiedPath, renamedPath);
    await service.checkForExternalChange(modifiedPath);
    expect(events).toContain('renamed');

    service.untrack(modifiedPath);
    await service.open(renamedPath);
    await fs.unlink(renamedPath);
    await service.checkForExternalChange(renamedPath);
    expect(events).toContain('deleted');
  });

  it('serializes concurrent saves so the same stale fingerprint cannot win twice', async () => {
    const target = path.join(root, 'concurrent.md');
    await fs.writeFile(target, 'baseline');
    const opened = await service.open(target);
    const [first, second] = await Promise.all([
      service.save({ path: target, content: 'first', expectedFingerprint: opened.fingerprint }),
      service.save({ path: target, content: 'second', expectedFingerprint: opened.fingerprint }),
    ]);
    expect([first.status, second.status].sort()).toEqual(['conflict', 'saved']);
    expect(['first', 'second']).toContain(await fs.readFile(target, 'utf8'));
  });

  it('captures an invalid-destination write failure without damaging editor recovery text', async () => {
    const blocked = path.join(root, 'blocked');
    await fs.writeFile(blocked, 'sentinel');
    const target = path.join(blocked, 'note.md');
    const result = await checkedSave({
      path: target,
      content: 'Unicode editor: नमस्ते',
      documentId: 'failure_doc',
      documentName: 'note.md',
    });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'INVALID_DESTINATION' } });
    expect(await fs.readFile(blocked, 'utf8')).toBe('sentinel');
    expect(await store.listLatest()).toMatchObject([{ id: 'failure_doc', content: 'Unicode editor: नमस्ते', reason: 'write-failure' }]);
  });

  it('reports and preserves a Windows read-only destination', async () => {
    if (process.platform !== 'win32') return;
    const target = path.join(root, 'read-only.md');
    await fs.writeFile(target, 'disk text');
    await service.open(target);
    await fs.chmod(target, 0o444);
    try {
      const result = await checkedSave({
        path: target,
        content: 'editor text',
        documentId: 'read_only_doc',
      });
      expect(result).toMatchObject({ status: 'failed', failure: { code: 'READ_ONLY' } });
      expect(await fs.readFile(target, 'utf8')).toBe('disk text');
      expect(await store.listLatest()).toMatchObject([
        { id: 'read_only_doc', content: 'editor text', reason: 'write-failure' },
      ]);
    } finally {
      await fs.chmod(target, 0o666);
    }
  });

  it('preserves CRLF and Unicode exactly in autosave history', async () => {
    const content = '# शीर्षक\r\n\r\nEmoji: 📝\r\n';
    await store.saveSnapshot({ id: 'unicode_doc', content, lineEnding: 'CRLF', reason: 'autosave' });
    const reloaded = new RecoveryStore(path.join(root, 'app-data', 'recovery'));
    expect(await reloaded.listLatest()).toMatchObject([{ content, lineEnding: 'CRLF' }]);
  });

  it('bounds autosave retention over repeated open/close-style cycles', async () => {
    const bounded = new RecoveryStore(path.join(root, 'bounded'), { maximumSnapshotsPerDocument: 5 });
    for (let cycle = 0; cycle < 30; cycle += 1) {
      await bounded.saveSnapshot({ id: 'tab_doc', content: `cycle ${cycle}` });
    }
    const history = await bounded.listHistory('tab_doc');
    expect(history).toHaveLength(5);
    expect(history.some((entry) => entry.content === 'cycle 29')).toBe(true);
  });
});
