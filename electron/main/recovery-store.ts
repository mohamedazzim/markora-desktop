import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';

export interface RecoverySnapshotInput {
  readonly id: string;
  readonly path?: string;
  readonly name?: string;
  readonly content: string;
  readonly lineEnding?: 'LF' | 'CRLF';
  readonly reason?: 'autosave' | 'shutdown' | 'conflict' | 'write-failure';
}

export interface RecoverySnapshot extends RecoverySnapshotInput {
  readonly version: 1;
  readonly snapshotId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SessionDocumentRecord {
  readonly id: string;
  readonly path?: string;
  readonly name: string;
  readonly mode: 'source' | 'structured';
  readonly active: boolean;
}

export interface RecoverySession {
  readonly version: 1;
  readonly savedAt: number;
  readonly workspacePath?: string;
  readonly documents: readonly SessionDocumentRecord[];
}

export interface RecoveryStoreOptions {
  readonly maximumSnapshotsPerDocument?: number;
  readonly maximumContentBytes?: number;
  readonly now?: () => number;
}

const identifierPattern = /^[a-zA-Z0-9_-]{1,128}$/u;
const markdownExtensions = new Set(['.md', '.markdown']);

function isAbsoluteMarkdownPath(candidate: string): boolean {
  return (
    path.isAbsolute(candidate)
    && !candidate.includes('\0')
    && markdownExtensions.has(path.extname(candidate).toLowerCase())
  );
}

function validateSnapshot(input: RecoverySnapshotInput, maximumContentBytes: number): void {
  if (!identifierPattern.test(input.id)) throw new Error('Recovery document identifiers are invalid.');
  if (Buffer.byteLength(input.content, 'utf8') > maximumContentBytes) {
    throw new Error('The recovery snapshot exceeds the configured size limit.');
  }
  if (input.path && !isAbsoluteMarkdownPath(input.path)) {
    throw new Error('Recovery file paths must be absolute Markdown paths.');
  }
}

async function atomicJsonWrite(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let created = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(JSON.stringify(value, null, 2), { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
    created = false;
  } finally {
    if (created) await unlink(temporary).catch(() => undefined);
  }
}

function isSnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RecoverySnapshot>;
  return (
    candidate.version === 1 &&
    typeof candidate.snapshotId === 'string' &&
    typeof candidate.id === 'string' &&
    identifierPattern.test(candidate.id) &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.updatedAt === 'number'
    && Number.isFinite(candidate.updatedAt)
    && (candidate.path === undefined
      || (typeof candidate.path === 'string'
        && isAbsoluteMarkdownPath(candidate.path)))
    && (candidate.lineEnding === undefined
      || candidate.lineEnding === 'LF'
      || candidate.lineEnding === 'CRLF')
    && (candidate.reason === undefined
      || candidate.reason === 'autosave'
      || candidate.reason === 'shutdown'
      || candidate.reason === 'conflict'
      || candidate.reason === 'write-failure')
  );
}

function validateSessionDocument(value: unknown): value is SessionDocumentRecord {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SessionDocumentRecord>;
  return (
    typeof candidate.id === 'string'
    && identifierPattern.test(candidate.id)
    && typeof candidate.name === 'string'
    && candidate.name.length > 0
    && candidate.name.length <= 512
    && (candidate.mode === 'source' || candidate.mode === 'structured')
    && typeof candidate.active === 'boolean'
    && (candidate.path === undefined
      || (typeof candidate.path === 'string'
        && isAbsoluteMarkdownPath(candidate.path)))
  );
}

function validateSession(
  session: Omit<RecoverySession, 'version' | 'savedAt'>,
): void {
  if (session.workspacePath && (!path.isAbsolute(session.workspacePath) || session.workspacePath.includes('\0'))) {
    throw new Error('Session workspace paths must be absolute.');
  }
  if (session.documents.length > 100) throw new Error('A session may contain at most 100 documents.');
  if (!session.documents.every(validateSessionDocument)) {
    throw new Error('The recovery session contains an invalid document record.');
  }
  const ids = new Set(session.documents.map((document) => document.id));
  if (ids.size !== session.documents.length) {
    throw new Error('Recovery session document identifiers must be unique.');
  }
  if (session.documents.filter((document) => document.active).length > 1) {
    throw new Error('A recovery session may have only one active document.');
  }
}

export class RecoveryStore {
  private readonly maximumSnapshots: number;
  private readonly maximumContentBytes: number;
  private readonly now: () => number;
  private readonly snapshotQueues = new Map<string, Promise<void>>();
  private sessionQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly root: string,
    options: RecoveryStoreOptions = {},
  ) {
    if (!path.isAbsolute(root) || root.includes('\0')) throw new Error('Recovery root must be absolute.');
    this.maximumSnapshots = Math.max(1, Math.min(100, options.maximumSnapshotsPerDocument ?? 10));
    this.maximumContentBytes = Math.max(1_024, options.maximumContentBytes ?? 25_000_000);
    this.now = options.now ?? Date.now;
  }

  async saveSnapshot(input: RecoverySnapshotInput): Promise<RecoverySnapshot> {
    validateSnapshot(input, this.maximumContentBytes);
    const previous = this.snapshotQueues.get(input.id) ?? Promise.resolve();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.snapshotQueues.set(input.id, queued);
    await previous.catch(() => undefined);
    try {
      return await this.saveSnapshotUnlocked(input);
    } finally {
      release();
      if (this.snapshotQueues.get(input.id) === queued) this.snapshotQueues.delete(input.id);
    }
  }

  private async saveSnapshotUnlocked(input: RecoverySnapshotInput): Promise<RecoverySnapshot> {
    const timestamp = this.now();
    const snapshot: RecoverySnapshot = {
      ...input,
      version: 1,
      snapshotId: `${timestamp}-${randomUUID()}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      reason: input.reason ?? 'autosave',
    };
    const documentRoot = path.join(this.root, 'documents', input.id);
    const historyPath = path.join(documentRoot, 'history', `${snapshot.snapshotId}.json`);
    await atomicJsonWrite(historyPath, snapshot);
    await atomicJsonWrite(path.join(documentRoot, 'latest.json'), snapshot);
    await this.pruneDocument(input.id);
    return snapshot;
  }

  async listLatest(): Promise<RecoverySnapshot[]> {
    const documentsRoot = path.join(this.root, 'documents');
    let entries;
    try {
      entries = await readdir(documentsRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw error;
    }
    const snapshots: RecoverySnapshot[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !identifierPattern.test(entry.name)) continue;
      try {
        const value = JSON.parse(
          await readFile(path.join(documentsRoot, entry.name, 'latest.json'), 'utf8'),
        ) as unknown;
        if (isSnapshot(value)) snapshots.push(value);
      } catch {
        // A single corrupt snapshot must not prevent recovery of other documents.
      }
    }
    return snapshots.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async listHistory(id: string): Promise<RecoverySnapshot[]> {
    if (!identifierPattern.test(id)) throw new Error('Recovery document identifiers are invalid.');
    const historyRoot = path.join(this.root, 'documents', id, 'history');
    let files: string[];
    try {
      files = await readdir(historyRoot);
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw error;
    }
    const snapshots: RecoverySnapshot[] = [];
    for (const file of files.filter((name) => name.endsWith('.json'))) {
      try {
        const value = JSON.parse(await readFile(path.join(historyRoot, file), 'utf8')) as unknown;
        if (isSnapshot(value)) snapshots.push(value);
      } catch {
        // Skip partial/corrupt history entries.
      }
    }
    return snapshots.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async clear(id: string): Promise<void> {
    if (!identifierPattern.test(id)) throw new Error('Recovery document identifiers are invalid.');
    const documentRoot = path.join(this.root, 'documents', id);
    const history = await this.listHistory(id);
    await Promise.all(history.map((entry) => unlink(path.join(documentRoot, 'history', `${entry.snapshotId}.json`))));
    await unlink(path.join(documentRoot, 'latest.json')).catch(() => undefined);
  }

  async saveSession(session: Omit<RecoverySession, 'version' | 'savedAt'>): Promise<void> {
    validateSession(session);
    const operation = this.sessionQueue.catch(() => undefined).then(() =>
      atomicJsonWrite(path.join(this.root, 'session.json'), {
        ...session,
        version: 1,
        savedAt: this.now(),
      } satisfies RecoverySession),
    );
    this.sessionQueue = operation;
    await operation;
  }

  async loadSession(): Promise<RecoverySession | null> {
    try {
      const value = JSON.parse(await readFile(path.join(this.root, 'session.json'), 'utf8')) as Partial<RecoverySession>;
      if (
        value.version !== 1
        || !Array.isArray(value.documents)
        || typeof value.savedAt !== 'number'
        || !Number.isFinite(value.savedAt)
      ) {
        return null;
      }
      const session = value as RecoverySession;
      validateSession({ workspacePath: session.workspacePath, documents: session.documents });
      return session;
    } catch {
      return null;
    }
  }

  private async pruneDocument(id: string): Promise<void> {
    const history = await this.listHistory(id);
    const stale = history.slice(this.maximumSnapshots);
    await Promise.all(
      stale.map((entry) =>
        unlink(path.join(this.root, 'documents', id, 'history', `${entry.snapshotId}.json`)),
      ),
    );
  }
}
