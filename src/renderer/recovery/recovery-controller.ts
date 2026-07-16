import type {
  DiskFingerprintRecord,
  ExternalFileChangeEvent,
  FileRecord,
  RecoverySessionDocument,
  RecoverySessionRecord,
  RecoverySnapshotRecord,
  SaveFileConflict,
  SaveFileRequest,
  SaveFileResult,
} from '../../shared/contracts';

export interface RecoveryApi {
  saveFileChecked(request: SaveFileRequest): Promise<SaveFileResult | null>;
  acceptDiskVersion(request: { path: string; fingerprint: DiskFingerprintRecord }): Promise<void>;
  unwatchFile(path: string): Promise<void>;
  openPath(path: string): Promise<FileRecord>;
  saveRecovery(entry: {
    id: string;
    path?: string;
    name?: string;
    content: string;
    lineEnding?: 'LF' | 'CRLF';
    reason?: 'autosave' | 'shutdown' | 'conflict' | 'write-failure';
  }): Promise<RecoverySnapshotRecord>;
  getRecoveries(): Promise<RecoverySnapshotRecord[]>;
  clearRecovery(id: string): Promise<void>;
  saveRecoverySession(session: {
    workspacePath?: string;
    documents: RecoverySessionDocument[];
  }): Promise<void>;
  loadRecoverySession(): Promise<RecoverySessionRecord | null>;
}

export interface RecoverableDocument {
  id: string;
  path?: string;
  name: string;
  content: string;
  lineEnding: 'LF' | 'CRLF';
  mode: 'source' | 'structured';
  active: boolean;
  dirty: boolean;
}

export interface RestorePlanItem {
  id: string;
  path?: string;
  name: string;
  mode: 'source' | 'structured';
  active: boolean;
  source: 'snapshot' | 'disk';
  snapshot?: RecoverySnapshotRecord;
}

export interface EditorDiskConflict {
  result: SaveFileConflict;
  document: RecoverableDocument;
  /** Timestamp at which Markora observed the external change (epoch ms). */
  detectedAt?: number;
}

export type ConflictResolution = 'reload' | 'keep' | 'save-copy' | 'overwrite';

export type ConflictResolutionResult =
  | { action: 'reload'; file: FileRecord }
  | { action: 'keep'; snapshot: RecoverySnapshotRecord }
  | { action: 'saved'; result: Extract<SaveFileResult, { status: 'saved' }> }
  | { action: 'cancelled' }
  | { action: 'unresolved'; result: Exclude<SaveFileResult, { status: 'saved' }> };

function fileKey(candidate: string): string {
  const normalized = candidate.replaceAll('\\', '/');
  return /^\p{L}:/u.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

export function createRestorePlan(
  session: RecoverySessionRecord | null,
  snapshots: readonly RecoverySnapshotRecord[],
): RestorePlanItem[] {
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const result: RestorePlanItem[] = [];
  for (const document of session?.documents ?? []) {
    const snapshot = snapshotById.get(document.id);
    result.push({
      id: document.id,
      path: snapshot?.path ?? document.path,
      name: snapshot?.name ?? document.name,
      mode: document.mode,
      active: document.active,
      source: snapshot ? 'snapshot' : 'disk',
      snapshot,
    });
    snapshotById.delete(document.id);
  }
  for (const snapshot of snapshotById.values()) {
    result.push({
      id: snapshot.id,
      path: snapshot.path,
      name: snapshot.name || snapshot.path?.split(/[\\/]/u).pop() || 'Recovered.md',
      mode: 'source',
      active: !result.some((item) => item.active),
      source: 'snapshot',
      snapshot,
    });
  }
  if (result.length && !result.some((item) => item.active)) result[0].active = true;
  return result;
}

export class RecoveryController {
  private readonly fingerprints = new Map<string, DiskFingerprintRecord>();

  constructor(private readonly api: RecoveryApi) {}

  rememberFile(record: FileRecord): void {
    if (record.fingerprint) this.fingerprints.set(fileKey(record.path), record.fingerprint);
  }

  forgetFile(filePath: string): void {
    this.fingerprints.delete(fileKey(filePath));
  }

  async save(document: RecoverableDocument, saveAs = false): Promise<SaveFileResult | null> {
    const path = saveAs ? undefined : document.path;
    const result = await this.api.saveFileChecked({
      path,
      content: document.content,
      expectedFingerprint: path ? this.fingerprints.get(fileKey(path)) : undefined,
      createBackup: true,
      documentId: document.id,
      documentName: document.name,
      lineEnding: document.lineEnding,
    });
    if (result?.status === 'saved') {
      if (saveAs && document.path && result.file.path !== document.path) {
        await this.api.unwatchFile(document.path);
        this.forgetFile(document.path);
      }
      this.rememberFile(result.file);
    }
    return result;
  }

  async resolveConflict(
    conflict: EditorDiskConflict,
    resolution: ConflictResolution,
  ): Promise<ConflictResolutionResult> {
    const { document, result } = conflict;
    if (resolution === 'reload') {
      let disk = result.conflict.disk;
      const reloadPath = result.conflict.renamedPath ?? result.conflict.path;
      if (!disk && result.conflict.kind !== 'deleted') {
        disk = await this.api.openPath(reloadPath);
      }
      if (!disk?.fingerprint) return { action: 'unresolved', result };
      if (disk.path !== result.conflict.path) await this.api.unwatchFile(result.conflict.path);
      await this.api.acceptDiskVersion({ path: disk.path, fingerprint: disk.fingerprint });
      this.forgetFile(result.conflict.path);
      this.rememberFile(disk);
      await this.api.clearRecovery(document.id);
      return { action: 'reload', file: disk };
    }
    if (resolution === 'keep') {
      const snapshot = await this.api.saveRecovery({
        id: document.id,
        path: document.path,
        name: document.name,
        content: document.content,
        lineEnding: document.lineEnding,
        reason: 'conflict',
      });
      return { action: 'keep', snapshot };
    }

    const saving = await this.api.saveFileChecked({
      path:
        resolution === 'save-copy'
          ? undefined
          : result.conflict.renamedPath ?? result.conflict.path,
      content: document.content,
      expectedFingerprint:
        resolution === 'overwrite' ? result.conflict.expected ?? undefined : undefined,
      overwrite: resolution === 'overwrite',
      overwriteConfirmed: resolution === 'overwrite',
      createBackup: true,
      documentId: document.id,
      documentName: document.name,
      lineEnding: document.lineEnding,
    });
    if (!saving) return { action: 'cancelled' };
    if (saving.status !== 'saved') return { action: 'unresolved', result: saving };
    if (document.path && saving.file.path !== document.path) {
      await this.api.unwatchFile(document.path);
      this.forgetFile(document.path);
    }
    this.rememberFile(saving.file);
    await this.api.clearRecovery(document.id);
    return { action: 'saved', result: saving };
  }

  async persistSession(
    documents: readonly RecoverableDocument[],
    workspacePath?: string,
    reason: 'autosave' | 'shutdown' = 'autosave',
  ): Promise<void> {
    await Promise.all(
      documents
        .filter((document) => document.dirty)
        .map((document) =>
          this.api.saveRecovery({
            id: document.id,
            path: document.path,
            name: document.name,
            content: document.content,
            lineEnding: document.lineEnding,
            reason,
          }),
        ),
    );
    await this.api.saveRecoverySession({
      workspacePath,
      documents: documents.map((document) => ({
        id: document.id,
        path: document.path,
        name: document.name,
        mode: document.mode,
        active: document.active,
      })),
    });
  }

  async loadRestorePlan(): Promise<RestorePlanItem[]> {
    const [session, snapshots] = await Promise.all([
      this.api.loadRecoverySession(),
      this.api.getRecoveries(),
    ]);
    return createRestorePlan(session, snapshots);
  }

  async restore(item: RestorePlanItem): Promise<FileRecord | RecoverySnapshotRecord> {
    if (item.snapshot) return item.snapshot;
    if (!item.path) throw new Error('The session document no longer has a disk path.');
    const file = await this.api.openPath(item.path);
    this.rememberFile(file);
    return file;
  }

  externalConflict(
    event: ExternalFileChangeEvent,
    document: RecoverableDocument,
  ): EditorDiskConflict {
    return {
      document,
      result: {
        status: 'conflict',
        conflict: {
          kind: event.kind,
          path: event.path,
          renamedPath: event.renamedPath,
          expected: event.previousFingerprint,
          actual: event.fingerprint,
          disk: event.record,
        },
      },
    };
  }
}
