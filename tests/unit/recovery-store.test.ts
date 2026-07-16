import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecoveryStore } from '../../electron/main/recovery-store';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-recovery-store-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('RecoveryStore', () => {
  it('atomically records latest and historical snapshots', async () => {
    const store = new RecoveryStore(root, { now: () => 1234 });
    const snapshot = await store.saveSnapshot({
      id: 'doc_1',
      name: 'नोट.md',
      content: '# recovered',
      reason: 'autosave',
    });
    expect(snapshot).toMatchObject({ version: 1, id: 'doc_1', createdAt: 1234 });
    expect(await store.listLatest()).toEqual([snapshot]);
    expect(await store.listHistory('doc_1')).toEqual([snapshot]);
    expect((await fs.readdir(path.join(root, 'documents', 'doc_1', 'history'))).every((name) => name.endsWith('.json'))).toBe(true);
  });

  it('retains only the configured number of snapshots per document', async () => {
    let time = 100;
    const store = new RecoveryStore(root, {
      maximumSnapshotsPerDocument: 3,
      now: () => (time += 1),
    });
    for (let index = 0; index < 7; index += 1) {
      await store.saveSnapshot({ id: 'retained', content: `revision ${index}` });
    }
    const history = await store.listHistory('retained');
    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.content)).toEqual(['revision 6', 'revision 5', 'revision 4']);
  });

  it('keeps documents isolated and sorts latest snapshots newest first', async () => {
    let time = 0;
    const store = new RecoveryStore(root, { now: () => ++time });
    await store.saveSnapshot({ id: 'first', content: 'one' });
    await store.saveSnapshot({ id: 'second', content: 'two' });
    expect((await store.listLatest()).map((entry) => entry.id)).toEqual(['second', 'first']);
  });

  it('serializes concurrent snapshots so the last invocation owns latest.json', async () => {
    let time = 10;
    const store = new RecoveryStore(root, { now: () => ++time });
    const snapshots = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.saveSnapshot({ id: 'concurrent', content: `revision ${index}` }),
      ),
    );
    expect(snapshots).toHaveLength(8);
    expect(await store.listLatest()).toMatchObject([{ content: 'revision 7', updatedAt: 18 }]);
  });

  it('skips a corrupt latest snapshot without hiding valid documents', async () => {
    const store = new RecoveryStore(root);
    await store.saveSnapshot({ id: 'valid', content: 'safe' });
    const corruptRoot = path.join(root, 'documents', 'corrupt');
    await fs.mkdir(corruptRoot, { recursive: true });
    await fs.writeFile(path.join(corruptRoot, 'latest.json'), '{not json');
    expect((await store.listLatest()).map((entry) => entry.id)).toEqual(['valid']);
  });

  it('clears latest and historical snapshots for one document', async () => {
    const store = new RecoveryStore(root);
    await store.saveSnapshot({ id: 'clear_me', content: 'one' });
    await store.saveSnapshot({ id: 'clear_me', content: 'two' });
    await store.clear('clear_me');
    expect(await store.listHistory('clear_me')).toEqual([]);
    expect(await store.listLatest()).toEqual([]);
  });

  it('rejects invalid identifiers, paths, and oversized text', async () => {
    const store = new RecoveryStore(root, { maximumContentBytes: 1_024 });
    await expect(store.saveSnapshot({ id: '../escape', content: 'x' })).rejects.toThrow(/identifiers/);
    await expect(store.saveSnapshot({ id: 'valid', path: 'relative.md', content: 'x' })).rejects.toThrow(/absolute/);
    await expect(store.saveSnapshot({ id: 'valid', path: path.join(root, 'bad.txt'), content: 'x' })).rejects.toThrow(/Markdown/);
    await expect(store.saveSnapshot({ id: 'valid', content: 'x'.repeat(1_025) })).rejects.toThrow(/exceeds/);
  });

  it('preserves line endings and failure reasons', async () => {
    const store = new RecoveryStore(root);
    const snapshot = await store.saveSnapshot({
      id: 'failure',
      content: 'a\r\nb',
      lineEnding: 'CRLF',
      reason: 'write-failure',
    });
    expect(snapshot).toMatchObject({ lineEnding: 'CRLF', reason: 'write-failure' });
  });

  it('saves and loads a validated multi-tab session', async () => {
    const store = new RecoveryStore(root, { now: () => 777 });
    await store.saveSession({
      workspacePath: root,
      documents: [
        { id: 'one', path: path.join(root, 'one.md'), name: 'one.md', mode: 'source', active: true },
        { id: 'two', name: 'Untitled.md', mode: 'structured', active: false },
      ],
    });
    expect(await store.loadSession()).toMatchObject({ version: 1, savedAt: 777 });
  });

  it('rejects duplicate ids, multiple active tabs, and invalid session paths', async () => {
    const store = new RecoveryStore(root);
    await expect(store.saveSession({ documents: [
      { id: 'same', name: 'a', mode: 'source', active: true },
      { id: 'same', name: 'b', mode: 'source', active: false },
    ] })).rejects.toThrow(/unique/);
    await expect(store.saveSession({ documents: [
      { id: 'one', name: 'a', mode: 'source', active: true },
      { id: 'two', name: 'b', mode: 'source', active: true },
    ] })).rejects.toThrow(/only one active/);
    await expect(store.saveSession({ workspacePath: 'relative', documents: [] })).rejects.toThrow(/absolute/);
  });

  it('returns null for corrupt or unsupported session data', async () => {
    const store = new RecoveryStore(root);
    await fs.writeFile(path.join(root, 'session.json'), JSON.stringify({ version: 99, documents: [], savedAt: 1 }));
    expect(await store.loadSession()).toBeNull();
    await fs.writeFile(path.join(root, 'session.json'), '{broken');
    expect(await store.loadSession()).toBeNull();
  });

  it('reports an application-data write failure without leaving temporary files', async () => {
    const blockedRoot = path.join(root, 'blocked');
    await fs.writeFile(blockedRoot, 'not a directory');
    const store = new RecoveryStore(blockedRoot);
    await expect(store.saveSnapshot({ id: 'doc', content: 'text' })).rejects.toThrow();
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
