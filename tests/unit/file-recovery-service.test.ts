import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyWriteFailure,
  FileRecoveryService,
  readMarkdownFileRecord,
} from '../../electron/main/file-recovery-service';

let root = '';
let service: FileRecoveryService;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-file-service-'));
  service = new FileRecoveryService({ backupRoot: path.join(root, 'backups'), watcherDebounceMs: 5_000 });
});

afterEach(async () => {
  service.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe('FileRecoveryService', () => {
  it('opens UTF-8 Markdown with a content fingerprint and line-ending record', async () => {
    const target = path.join(root, 'नोट.md');
    await fs.writeFile(target, '# title\r\ntext');
    const record = await service.open(target);
    expect(record).toMatchObject({ name: 'नोट.md', lineEnding: 'CRLF', content: '# title\r\ntext' });
    expect(record.fingerprint?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses the tracked open version for a checked save', async () => {
    const target = path.join(root, 'tracked.md');
    await fs.writeFile(target, 'opened');
    await service.open(target);
    const result = await service.save({ path: target, content: 'editor' });
    expect(result.status).toBe('saved');
    expect(await fs.readFile(target, 'utf8')).toBe('editor');
  });

  it('returns a rich conflict and preserves external modifications', async () => {
    const target = path.join(root, 'modified.md');
    await fs.writeFile(target, 'opened');
    await service.open(target);
    await fs.writeFile(target, 'external');
    const result = await service.save({ path: target, content: 'editor', documentId: 'doc' });
    expect(result).toMatchObject({ status: 'conflict', conflict: { kind: 'modified' } });
    if (result.status === 'conflict') expect(result.conflict.disk?.content).toBe('external');
    expect(await fs.readFile(target, 'utf8')).toBe('external');
  });

  it('detects deletion without recreating the missing file', async () => {
    const target = path.join(root, 'deleted.md');
    await fs.writeFile(target, 'opened');
    await service.open(target);
    await fs.unlink(target);
    const result = await service.save({ path: target, content: 'editor' });
    expect(result).toMatchObject({ status: 'conflict', conflict: { kind: 'deleted', actual: null } });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('detects same-directory renames during save and observation', async () => {
    const target = path.join(root, 'old.md');
    const renamed = path.join(root, 'renamed.md');
    await fs.writeFile(target, 'opened');
    await service.open(target);
    await fs.rename(target, renamed);
    expect(await service.checkForExternalChange(target)).toMatchObject({
      kind: 'renamed',
      renamedPath: renamed,
      record: { content: 'opened' },
    });
    expect(await service.save({ path: target, content: 'editor' })).toMatchObject({
      status: 'conflict',
      conflict: { kind: 'renamed', renamedPath: renamed },
    });
  });

  it('still detects a rename after the file was externally edited first', async () => {
    const target = path.join(root, 'edited-before-rename.md');
    const renamed = path.join(root, 'edited-and-renamed.md');
    await fs.writeFile(target, 'opened');
    await service.open(target);
    await fs.writeFile(target, 'externally edited');
    expect((await service.checkForExternalChange(target))?.kind).toBe('modified');
    await fs.rename(target, renamed);
    expect(await service.checkForExternalChange(target)).toMatchObject({
      kind: 'renamed',
      renamedPath: renamed,
      record: { content: 'externally edited' },
    });
    expect(await service.save({ path: target, content: 'editor' })).toMatchObject({
      status: 'conflict',
      conflict: { kind: 'renamed', renamedPath: renamed },
    });
  });

  it('suppresses duplicate observation events until disk content changes again', async () => {
    const target = path.join(root, 'observe.md');
    await fs.writeFile(target, 'one');
    await service.open(target);
    await fs.writeFile(target, 'two');
    expect((await service.checkForExternalChange(target))?.kind).toBe('modified');
    expect(await service.checkForExternalChange(target)).toBeNull();
    await fs.writeFile(target, 'three');
    expect((await service.checkForExternalChange(target))?.record?.content).toBe('three');
  });

  it('shares one concurrent observation and clears it before a later poll', async () => {
    const emitted: string[] = [];
    service.close();
    service = new FileRecoveryService({
      backupRoot: path.join(root, 'backups-concurrent'),
      watcherDebounceMs: 5_000,
      onExternalChange: (event) => emitted.push(event.kind),
    });
    const target = path.join(root, 'concurrent-observe.md');
    await fs.writeFile(target, 'one');
    await service.open(target);
    await fs.writeFile(target, 'two');

    const observations = await Promise.all([
      service.checkForExternalChange(target),
      service.checkForExternalChange(target),
    ]);

    expect(observations.map((event) => event?.kind)).toEqual(['modified', 'modified']);
    expect(emitted).toEqual(['modified']);
    expect(await service.checkForExternalChange(target)).toBeNull();
  });

  it('accepts a reloaded disk baseline before the next normal save', async () => {
    const target = path.join(root, 'reload.md');
    await fs.writeFile(target, 'one');
    await service.open(target);
    await fs.writeFile(target, 'two');
    const disk = await readMarkdownFileRecord(target);
    service.acceptDiskVersion(target, disk.fingerprint!);
    expect(await service.checkForExternalChange(target)).toBeNull();
    expect(await service.save({ path: target, content: 'three' })).toMatchObject({ status: 'saved' });
  });

  it('requires explicit confirmation for overwrite and retains a backup', async () => {
    const target = path.join(root, 'overwrite.md');
    await fs.writeFile(target, 'disk');
    const rejected = await service.save({ path: target, content: 'editor', overwrite: true });
    expect(rejected).toMatchObject({ status: 'failed', failure: { code: 'INVALID_DESTINATION' } });
    expect(await fs.readFile(target, 'utf8')).toBe('disk');

    const saved = await service.save({
      path: target,
      content: 'editor',
      overwrite: true,
      overwriteConfirmed: true,
    });
    expect(saved).toMatchObject({ status: 'saved' });
    if (saved.status === 'saved') expect(await fs.readFile(saved.backupPath!, 'utf8')).toBe('disk');
  });

  it('will not silently replace an untracked existing destination', async () => {
    const target = path.join(root, 'save-copy.md');
    await fs.writeFile(target, 'existing');
    expect(await service.save({ path: target, content: 'copy' })).toMatchObject({
      status: 'conflict',
      conflict: { kind: 'destination-exists', expected: null },
    });
  });

  it('creates a new untracked Markdown destination', async () => {
    const target = path.join(root, 'new.md');
    expect(await service.save({ path: target, content: '# new' })).toMatchObject({ status: 'saved' });
    expect(await fs.readFile(target, 'utf8')).toBe('# new');
  });

  it('classifies actionable Windows and filesystem write failures', () => {
    expect(classifyWriteFailure({ code: 'EROFS' }).code).toBe('READ_ONLY');
    expect(classifyWriteFailure({ code: 'EPERM' }).code).toBe('PERMISSION_DENIED');
    expect(classifyWriteFailure({ code: 'EACCES' }).code).toBe('PERMISSION_DENIED');
    expect(classifyWriteFailure({ code: 'ENOSPC' }).code).toBe('DISK_FULL');
    expect(classifyWriteFailure({ code: 'ENAMETOOLONG' }).code).toBe('PATH_TOO_LONG');
    expect(classifyWriteFailure({ code: 'ENOTDIR' }).code).toBe('INVALID_DESTINATION');
    expect(classifyWriteFailure(new Error('unexpected')).code).toBe('WRITE_FAILED');
  });

  it('returns a typed failure and leaves an invalid destination unchanged', async () => {
    const parentFile = path.join(root, 'not-a-folder');
    await fs.writeFile(parentFile, 'sentinel');
    const result = await service.save({ path: path.join(parentFile, 'child.md'), content: 'editor' });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'INVALID_DESTINATION' } });
    expect(await fs.readFile(parentFile, 'utf8')).toBe('sentinel');
  });

  it('emits modified, renamed, and deleted observations through one typed callback', async () => {
    const events: string[] = [];
    service.close();
    service = new FileRecoveryService({
      backupRoot: path.join(root, 'backups-2'),
      watcherDebounceMs: 0,
      onExternalChange: (event) => events.push(event.kind),
    });
    const target = path.join(root, 'event.md');
    await fs.writeFile(target, 'one');
    await service.open(target);
    await fs.writeFile(target, 'two');
    await service.checkForExternalChange(target);
    expect(events).toEqual(['modified']);
  });
});
