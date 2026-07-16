import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';

export interface DiskFingerprint {
  readonly modifiedAt: number;
  readonly size: number;
  readonly sha256: string;
}

export interface AtomicMarkdownWriteRequest {
  readonly filePath: string;
  readonly content: string;
  readonly expected?: DiskFingerprint;
  readonly overwrite?: boolean;
  readonly backupDirectory?: string;
  readonly maximumBackups?: number;
}

export interface AtomicMarkdownWriteResult {
  readonly fingerprint: DiskFingerprint;
  readonly backupPath?: string;
}

export class DiskConflictError extends Error {
  readonly code = 'DISK_CONFLICT' as const;

  constructor(
    message: string,
    readonly filePath: string,
    readonly expected: DiskFingerprint | null,
    readonly actual: DiskFingerprint | null,
  ) {
    super(message);
    this.name = 'DiskConflictError';
  }
}

const markdownExtensions = new Set(['.md', '.markdown']);

export function assertMarkdownFilePath(filePath: string): string {
  if (
    typeof filePath !== 'string' ||
    filePath.includes('\0') ||
    !path.isAbsolute(filePath) ||
    !markdownExtensions.has(path.extname(filePath).toLowerCase())
  ) {
    throw new Error('Choose an absolute .md or .markdown file path.');
  }
  return path.normalize(filePath);
}

export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function fingerprintFile(filePath: string): Promise<DiskFingerprint | null> {
  try {
    const [bytes, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
    if (!metadata.isFile()) return null;
    return {
      modifiedAt: metadata.mtimeMs,
      size: metadata.size,
      sha256: fingerprintBytes(bytes),
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  }
}

export function fingerprintsEqual(
  left: DiskFingerprint | null | undefined,
  right: DiskFingerprint | null | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.size === right.size && left.sha256 === right.sha256;
}

async function pruneBackups(directory: string, maximum: number): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => ({
        path: path.join(directory, entry.name),
        modifiedAt: (await stat(path.join(directory, entry.name))).mtimeMs,
      })),
  );
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  await Promise.all(
    candidates.slice(Math.max(1, Math.min(1_000, maximum))).map((entry) => unlink(entry.path)),
  );
}

async function createBackup(
  target: string,
  fingerprint: DiskFingerprint,
  backupDirectory: string,
  maximumBackups: number,
): Promise<string> {
  await mkdir(backupDirectory, { recursive: true });
  const base = path.basename(target).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const backupPath = path.join(
    backupDirectory,
    `${base}.${Date.now()}.${fingerprint.sha256.slice(0, 12)}.${randomUUID()}.bak`,
  );
  await copyFile(target, backupPath);
  await pruneBackups(backupDirectory, maximumBackups);
  return backupPath;
}

/**
 * Writes through a same-directory temporary file, flushes it, and performs an
 * optimistic disk-version check immediately before replacement.
 */
export async function writeMarkdownAtomic(
  request: AtomicMarkdownWriteRequest,
): Promise<AtomicMarkdownWriteResult> {
  const target = assertMarkdownFilePath(request.filePath);
  const expected = request.expected;
  const before = await fingerprintFile(target);
  if (before && !expected && !request.overwrite) {
    throw new DiskConflictError(
      'The destination already exists. Confirm overwrite or choose another file.',
      target,
      null,
      before,
    );
  }
  if (expected && !request.overwrite && !fingerprintsEqual(expected, before)) {
    throw new DiskConflictError(
      before ? 'The file changed on disk after it was opened.' : 'The file was deleted on disk.',
      target,
      expected,
      before,
    );
  }

  let backupPath: string | undefined;
  if (before && request.backupDirectory) {
    backupPath = await createBackup(
      target,
      before,
      request.backupDirectory,
      request.maximumBackups ?? 20,
    );
  }

  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  let temporaryExists = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(request.content, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }

    const immediatelyBeforeReplace = await fingerprintFile(target);
    if (expected && !request.overwrite && !fingerprintsEqual(expected, immediatelyBeforeReplace)) {
      throw new DiskConflictError(
        immediatelyBeforeReplace
          ? 'The file changed while Markora was preparing the save.'
          : 'The file was deleted while Markora was preparing the save.',
        target,
        expected,
        immediatelyBeforeReplace,
      );
    }
    await rename(temporary, target);
    temporaryExists = false;
    const fingerprint = await fingerprintFile(target);
    if (!fingerprint) throw new Error('The saved file could not be verified after replacement.');
    return { fingerprint, backupPath };
  } finally {
    if (temporaryExists) await unlink(temporary).catch(() => undefined);
  }
}

export async function findRenamedMarkdownFile(
  missingPath: string,
  expected: DiskFingerprint,
  maximumCandidates = 2_000,
): Promise<string | null> {
  const directory = path.dirname(assertMarkdownFilePath(missingPath));
  const entries = await readdir(directory, { withFileTypes: true });
  let checked = 0;
  for (const entry of entries) {
    if (checked >= maximumCandidates) break;
    if (!entry.isFile() || !markdownExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const candidate = path.join(directory, entry.name);
    if (path.normalize(candidate).toLowerCase() === path.normalize(missingPath).toLowerCase()) continue;
    checked += 1;
    const fingerprint = await fingerprintFile(candidate);
    if (fingerprintsEqual(expected, fingerprint)) return candidate;
  }
  return null;
}
