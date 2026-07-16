import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertMarkdownFilePath,
  DiskConflictError,
  findRenamedMarkdownFile,
  fingerprintBytes,
  fingerprintFile,
  fingerprintsEqual,
  writeMarkdownAtomic,
} from '../../electron/main/atomic-file';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'markora-atomic-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('atomic Markdown file writes', () => {
  it('accepts only absolute Markdown destinations', () => {
    expect(assertMarkdownFilePath(path.join(root, 'note.md'))).toBe(path.join(root, 'note.md'));
    expect(() => assertMarkdownFilePath('relative.md')).toThrow(/absolute/);
    expect(() => assertMarkdownFilePath(path.join(root, 'note.txt'))).toThrow(/Markdown/i);
    expect(() => assertMarkdownFilePath(`${path.join(root, 'note.md')}\0bad`)).toThrow();
  });

  it('fingerprints bytes deterministically and ignores timestamp-only differences', () => {
    const digest = fingerprintBytes(Buffer.from('same'));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      fingerprintsEqual(
        { modifiedAt: 1, size: 4, sha256: digest },
        { modifiedAt: 2, size: 4, sha256: digest },
      ),
    ).toBe(true);
    expect(fingerprintsEqual(null, undefined)).toBe(false);
  });

  it('creates and verifies a new UTF-8 file', async () => {
    const target = path.join(root, 'Unicode-नोट.md');
    const result = await writeMarkdownAtomic({ filePath: target, content: '# नमस्ते\r\n' });
    expect(await fs.readFile(target, 'utf8')).toBe('# नमस्ते\r\n');
    expect(result.fingerprint.sha256).toBe((await fingerprintFile(target))?.sha256);
  });

  it('does not replace an existing destination without a baseline or confirmation', async () => {
    const target = path.join(root, 'existing.md');
    await fs.writeFile(target, 'disk');
    await expect(writeMarkdownAtomic({ filePath: target, content: 'editor' })).rejects.toMatchObject({
      name: 'DiskConflictError',
      expected: null,
    });
    expect(await fs.readFile(target, 'utf8')).toBe('disk');
  });

  it('performs an optimistic save when the baseline still matches', async () => {
    const target = path.join(root, 'checked.md');
    await fs.writeFile(target, 'before');
    const expected = (await fingerprintFile(target))!;
    await writeMarkdownAtomic({ filePath: target, content: 'after', expected });
    expect(await fs.readFile(target, 'utf8')).toBe('after');
  });

  it('preserves a newer external version on conflict', async () => {
    const target = path.join(root, 'conflict.md');
    await fs.writeFile(target, 'opened');
    const expected = (await fingerprintFile(target))!;
    await fs.writeFile(target, 'external');
    const error = await writeMarkdownAtomic({ filePath: target, content: 'editor', expected }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DiskConflictError);
    expect(error).toMatchObject({ code: 'DISK_CONFLICT', expected });
    expect(await fs.readFile(target, 'utf8')).toBe('external');
  });

  it('reports deletion instead of recreating a file behind the editor', async () => {
    const target = path.join(root, 'deleted.md');
    await fs.writeFile(target, 'opened');
    const expected = (await fingerprintFile(target))!;
    await fs.unlink(target);
    await expect(
      writeMarkdownAtomic({ filePath: target, content: 'editor', expected }),
    ).rejects.toMatchObject({ actual: null });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains a backup before a confirmed overwrite', async () => {
    const target = path.join(root, 'overwrite.md');
    const backups = path.join(root, 'backups');
    await fs.writeFile(target, 'newer disk');
    const result = await writeMarkdownAtomic({
      filePath: target,
      content: 'confirmed editor',
      overwrite: true,
      backupDirectory: backups,
    });
    expect(result.backupPath).toBeTruthy();
    expect(await fs.readFile(result.backupPath!, 'utf8')).toBe('newer disk');
    expect(await fs.readFile(target, 'utf8')).toBe('confirmed editor');
  });

  it('bounds retained backup history', async () => {
    const target = path.join(root, 'retention.md');
    const backups = path.join(root, 'backups');
    await fs.writeFile(target, 'version 0');
    for (let index = 1; index <= 5; index += 1) {
      await writeMarkdownAtomic({
        filePath: target,
        content: `version ${index}`,
        overwrite: true,
        backupDirectory: backups,
        maximumBackups: 2,
      });
    }
    expect((await fs.readdir(backups)).length).toBe(2);
  });

  it('removes same-directory temporary files when replacement fails', async () => {
    const target = path.join(root, 'folder.md');
    await fs.mkdir(target);
    await expect(
      writeMarkdownAtomic({ filePath: target, content: 'cannot replace directory', overwrite: true }),
    ).rejects.toThrow();
    expect((await fs.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('detects a same-directory rename by content fingerprint', async () => {
    const oldPath = path.join(root, 'before.md');
    const newPath = path.join(root, 'after.markdown');
    await fs.writeFile(oldPath, 'unchanged content');
    const fingerprint = (await fingerprintFile(oldPath))!;
    await fs.rename(oldPath, newPath);
    expect(await findRenamedMarkdownFile(oldPath, fingerprint)).toBe(newPath);
  });

  it('returns null when a deleted file has no matching rename candidate', async () => {
    const missing = path.join(root, 'missing.md');
    const digest = fingerprintBytes(Buffer.from('missing'));
    expect(
      await findRenamedMarkdownFile(missing, { modifiedAt: 0, size: 7, sha256: digest }),
    ).toBeNull();
  });
});

