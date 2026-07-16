import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  DiskFingerprintRecord,
  ExternalFileChangeEvent,
  FileRecord,
  SaveFailureCode,
  SaveFileRequest,
  SaveFileResult,
} from '../../src/shared/contracts';
import {
  assertMarkdownFilePath,
  DiskConflictError,
  findRenamedMarkdownFile,
  fingerprintFile,
  fingerprintsEqual,
  writeMarkdownAtomic,
  type DiskFingerprint,
} from './atomic-file';

export interface FileRecoveryServiceOptions {
  readonly backupRoot: string;
  readonly onExternalChange?: (event: ExternalFileChangeEvent) => void;
  readonly watcherDebounceMs?: number;
  readonly now?: () => number;
}

interface TrackedFile {
  path: string;
  baseline: DiskFingerprint;
  observedFingerprint: DiskFingerprint;
  lastObservation?: string;
  watcher?: FSWatcher;
  timer?: ReturnType<typeof setTimeout>;
  checking?: Promise<ExternalFileChangeEvent | null>;
}

const markdownExtensions = new Set(['.md', '.markdown']);

function pathKey(candidate: string): string {
  const resolved = path.resolve(candidate);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function observationKey(fingerprint: DiskFingerprint | null, renamedPath?: string): string {
  return renamedPath
    ? `renamed:${pathKey(renamedPath)}:${fingerprint?.sha256 ?? 'missing'}`
    : fingerprint
      ? `file:${fingerprint.size}:${fingerprint.sha256}`
      : 'deleted';
}

function isMarkdownFilename(filename: string): boolean {
  return markdownExtensions.has(path.extname(filename).toLowerCase());
}

export async function readMarkdownFileRecord(filePath: string): Promise<FileRecord> {
  const target = assertMarkdownFilePath(filePath);
  const [content, metadata, fingerprint] = await Promise.all([
    readFile(target, 'utf8'),
    stat(target),
    fingerprintFile(target),
  ]);
  if (!metadata.isFile() || !fingerprint) throw new Error('The Markdown path is not a file.');
  return {
    path: target,
    name: path.basename(target),
    content,
    lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF',
    modifiedAt: metadata.mtimeMs,
    fingerprint,
  };
}

function backupDirectoryFor(root: string, target: string): string {
  const normalized = pathKey(target);
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  const safeName = path.basename(target).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return path.join(root, `${safeName || 'document'}-${digest}`);
}

export function classifyWriteFailure(error: unknown): {
  code: SaveFailureCode;
  message: string;
  systemCode?: string;
} {
  const systemCode = (error as { code?: string } | undefined)?.code;
  switch (systemCode) {
    case 'EROFS':
      return { code: 'READ_ONLY', message: 'The destination is on a read-only volume.', systemCode };
    case 'EACCES':
    case 'EPERM':
      return {
        code: 'PERMISSION_DENIED',
        message: 'Markora does not have permission to write the destination.',
        systemCode,
      };
    case 'ENOSPC':
    case 'EDQUOT':
      return { code: 'DISK_FULL', message: 'The destination does not have enough free space.', systemCode };
    case 'ENAMETOOLONG':
      return { code: 'PATH_TOO_LONG', message: 'The destination path is too long.', systemCode };
    case 'ENOENT':
    case 'ENOTDIR':
    case 'EISDIR':
    case 'EEXIST':
    case 'EINVAL':
      return {
        code: 'INVALID_DESTINATION',
        message: 'The selected destination is no longer available or is not a writable file path.',
        systemCode,
      };
    default:
      return {
        code: 'WRITE_FAILED',
        message: error instanceof Error ? error.message : 'The file could not be written.',
        systemCode,
      };
  }
}

async function classifyWriteFailureForPath(
  error: unknown,
  target: string,
): Promise<ReturnType<typeof classifyWriteFailure>> {
  const classified = classifyWriteFailure(error);
  if (classified.code !== 'PERMISSION_DENIED') return classified;
  try {
    const metadata = await stat(target);
    if ((metadata.mode & 0o222) === 0) {
      return {
        code: 'READ_ONLY',
        message: 'The destination file is marked read-only.',
        systemCode: classified.systemCode,
      };
    }
  } catch {
    // Keep the permission classification when metadata cannot be inspected.
  }
  return classified;
}

/**
 * Owns the disk version associated with each open document. Editor state stays
 * in the renderer; this service only performs checked disk I/O and observation.
 */
export class FileRecoveryService {
  private readonly tracked = new Map<string, TrackedFile>();
  private readonly saveQueues = new Map<string, Promise<void>>();
  private readonly debounceMs: number;
  private readonly now: () => number;

  constructor(private readonly options: FileRecoveryServiceOptions) {
    if (!path.isAbsolute(options.backupRoot) || options.backupRoot.includes('\0')) {
      throw new Error('The backup root must be an absolute path.');
    }
    this.debounceMs = Math.max(0, Math.min(5_000, options.watcherDebounceMs ?? 120));
    this.now = options.now ?? Date.now;
  }

  async open(filePath: string): Promise<FileRecord> {
    const record = await readMarkdownFileRecord(filePath);
    this.track(record.path, record.fingerprint!);
    return record;
  }

  async save(request: SaveFileRequest & { path: string }): Promise<SaveFileResult> {
    const target = assertMarkdownFilePath(request.path);
    const key = pathKey(target);
    const expectedAtInvocation = request.expectedFingerprint ?? this.tracked.get(key)?.baseline;
    const previous = this.saveQueues.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.saveQueues.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await this.saveUnlocked(
        { ...request, expectedFingerprint: expectedAtInvocation },
        target,
      );
    } finally {
      release();
      if (this.saveQueues.get(key) === queued) this.saveQueues.delete(key);
    }
  }

  private async saveUnlocked(
    request: SaveFileRequest & { path: string },
    target: string,
  ): Promise<SaveFileResult> {
    const tracked = this.tracked.get(pathKey(target));
    const expected = request.expectedFingerprint ?? tracked?.baseline;
    const overwrite = request.overwrite === true && request.overwriteConfirmed === true;

    if (request.overwrite === true && request.overwriteConfirmed !== true) {
      return {
        status: 'failed',
        failure: {
          code: 'INVALID_DESTINATION',
          path: target,
          message: 'Overwrite was not performed because explicit confirmation was missing.',
        },
      };
    }

    try {
      const result = await writeMarkdownAtomic({
        filePath: target,
        content: request.content,
        expected,
        overwrite,
        backupDirectory:
          request.createBackup === false ? undefined : backupDirectoryFor(this.options.backupRoot, target),
        maximumBackups: 20,
      });
      const file = await readMarkdownFileRecord(target);
      this.track(target, result.fingerprint);
      return { status: 'saved', file, backupPath: result.backupPath };
    } catch (error) {
      if (error instanceof DiskConflictError) {
        let renamedPath: string | null = null;
        if (error.expected && !error.actual) {
          renamedPath = await findRenamedMarkdownFile(
            target,
            tracked?.observedFingerprint ?? error.expected,
          ).catch(() => null);
        }
        let disk: FileRecord | undefined;
        if (error.actual) disk = await readMarkdownFileRecord(target).catch(() => undefined);
        return {
          status: 'conflict',
          conflict: {
            kind: renamedPath
              ? 'renamed'
              : !error.expected
                ? 'destination-exists'
                : error.actual
                  ? 'modified'
                  : 'deleted',
            path: target,
            renamedPath: renamedPath ?? undefined,
            expected: error.expected,
            actual: error.actual,
            disk,
          },
        };
      }
      const failure = await classifyWriteFailureForPath(error, target);
      return { status: 'failed', failure: { ...failure, path: target } };
    }
  }

  /** Accepts a disk version after the renderer explicitly chose Reload. */
  acceptDiskVersion(filePath: string, fingerprint: DiskFingerprintRecord): void {
    const target = assertMarkdownFilePath(filePath);
    this.track(target, fingerprint);
  }

  async checkForExternalChange(filePath: string): Promise<ExternalFileChangeEvent | null> {
    const target = assertMarkdownFilePath(filePath);
    const tracked = this.tracked.get(pathKey(target));
    if (!tracked) return null;
    if (tracked.checking) return tracked.checking;
    const checking = this.inspectExternalChange(target, tracked).finally(() => {
      if (tracked.checking === checking) tracked.checking = undefined;
    });
    tracked.checking = checking;
    return checking;
  }

  private async inspectExternalChange(
    target: string,
    tracked: TrackedFile,
  ): Promise<ExternalFileChangeEvent | null> {
    const actual = await fingerprintFile(target);

    if (fingerprintsEqual(tracked.baseline, actual)) {
      tracked.lastObservation = observationKey(actual);
      return null;
    }

    if (!actual) {
      const renamedPath = await findRenamedMarkdownFile(
        target,
        tracked.observedFingerprint,
      ).catch(() => null);
      if (renamedPath) {
        const renamedFingerprint = await fingerprintFile(renamedPath);
        const key = observationKey(renamedFingerprint, renamedPath);
        if (tracked.lastObservation === key) return null;
        tracked.lastObservation = key;
        const record = await readMarkdownFileRecord(renamedPath).catch(() => undefined);
        const event: ExternalFileChangeEvent = {
          kind: 'renamed',
          path: target,
          renamedPath,
          previousFingerprint: tracked.baseline,
          fingerprint: renamedFingerprint,
          record,
          observedAt: this.now(),
        };
        this.options.onExternalChange?.(event);
        return event;
      }
    }

    const key = observationKey(actual);
    if (tracked.lastObservation === key) return null;
    tracked.lastObservation = key;
    if (actual) tracked.observedFingerprint = actual;
    const record = actual ? await readMarkdownFileRecord(target).catch(() => undefined) : undefined;
    const event: ExternalFileChangeEvent = {
      kind: actual ? 'modified' : 'deleted',
      path: target,
      previousFingerprint: tracked.baseline,
      fingerprint: actual,
      record,
      observedAt: this.now(),
    };
    this.options.onExternalChange?.(event);
    return event;
  }

  untrack(filePath: string): void {
    const key = pathKey(filePath);
    const tracked = this.tracked.get(key);
    if (!tracked) return;
    if (tracked.timer) clearTimeout(tracked.timer);
    tracked.watcher?.close();
    this.tracked.delete(key);
  }

  close(): void {
    for (const tracked of this.tracked.values()) {
      if (tracked.timer) clearTimeout(tracked.timer);
      tracked.watcher?.close();
    }
    this.tracked.clear();
  }

  private track(filePath: string, baseline: DiskFingerprint): void {
    const target = assertMarkdownFilePath(filePath);
    const key = pathKey(target);
    const previous = this.tracked.get(key);
    if (previous?.timer) clearTimeout(previous.timer);
    previous?.watcher?.close();
    const tracked: TrackedFile = {
      path: target,
      baseline,
      observedFingerprint: baseline,
      lastObservation: observationKey(baseline),
    };
    try {
      tracked.watcher = watch(path.dirname(target), { persistent: false }, (_event, filename) => {
        if (filename) {
          const changed = filename.toString();
          if (changed !== path.basename(target) && !isMarkdownFilename(changed)) return;
        }
        if (tracked.timer) clearTimeout(tracked.timer);
        tracked.timer = setTimeout(() => {
          tracked.timer = undefined;
          void this.checkForExternalChange(target).catch(() => undefined);
        }, this.debounceMs);
      });
    } catch {
      // Checked saving still works when a network volume does not support fs.watch.
    }
    this.tracked.set(key, tracked);
  }
}
