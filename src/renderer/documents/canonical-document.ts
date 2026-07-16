/**
 * The editor-facing document model.
 *
 * Markdown is always stored with LF internally. The line ending observed on disk
 * is retained separately and is applied only when producing a save snapshot.
 * Keeping that distinction here prevents the source and structured editors from
 * becoming competing owners of document text.
 */

export type DiskLineEnding = 'lf' | 'crlf';
export type DocumentEditorMode = 'source' | 'structured';
export const DOCUMENT_HISTORY_MAX_ENTRIES = 500;
export const DOCUMENT_HISTORY_MAX_BYTES = 64 * 1024 * 1024;

export interface EditorSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface EditorViewState {
  readonly selection: EditorSelection;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

/** Flat shape intended for direct CodeMirror/Tiptap adapter consumption. */
export interface EditorViewSnapshot {
  readonly anchor: number;
  readonly head: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

export interface DocumentSnapshot {
  /** Canonical LF text. */
  readonly text: string;
  readonly lineEnding: DiskLineEnding;
  readonly revision: number;
}

export interface SaveTicket extends DocumentSnapshot {
  readonly id: number;
  /** Text ready to pass to the filesystem API. */
  readonly diskText: string;
}

export interface SaveCompletion {
  readonly status: 'saved' | 'stale';
  readonly savedRevision: number;
  readonly currentRevision: number;
  readonly dirty: boolean;
}

export type ExternalChangeKind =
  | 'unchanged'
  | 'line-ending-only'
  | 'matches-editor'
  | 'reload-safe'
  | 'conflict'
  | 'deleted-clean'
  | 'deleted-conflict';

export interface ExternalChangeClassification {
  readonly kind: ExternalChangeKind;
  readonly hasConflict: boolean;
  readonly disk: Omit<DocumentSnapshot, 'revision'> | null;
}

export interface TextUpdateResult {
  readonly changed: boolean;
  readonly revision: number;
  readonly dirty: boolean;
}

const EMPTY_VIEW_STATE: EditorViewState = Object.freeze({
  selection: Object.freeze({ anchor: 0, head: 0 }),
  scrollTop: 0,
  scrollLeft: 0,
});

function copySnapshot(snapshot: DocumentSnapshot): DocumentSnapshot {
  return {
    text: snapshot.text,
    lineEnding: snapshot.lineEnding,
    revision: snapshot.revision,
  };
}

function copyViewState(state: EditorViewState): EditorViewState {
  return {
    selection: { ...state.selection },
    scrollTop: state.scrollTop,
    scrollLeft: state.scrollLeft,
  };
}

function sameSerializedContent(
  left: Pick<DocumentSnapshot, 'text' | 'lineEnding'>,
  right: Pick<DocumentSnapshot, 'text' | 'lineEnding'>,
): boolean {
  return left.text === right.text && left.lineEnding === right.lineEnding;
}

function estimatedHistoryBytes(snapshot: Pick<DocumentSnapshot, 'text' | 'lineEnding'>): number {
  // V8 may use one-byte or two-byte strings; use the conservative UTF-16 size.
  return snapshot.text.length * 2 + snapshot.lineEnding.length * 2;
}

function validateLineEnding(lineEnding: DiskLineEnding): void {
  if (lineEnding !== 'lf' && lineEnding !== 'crlf') {
    throw new TypeError(`Unsupported disk line ending: ${String(lineEnding)}`);
  }
}

function validateSelection(selection: EditorSelection): void {
  for (const [name, value] of Object.entries(selection)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`Selection ${name} must be a non-negative safe integer.`);
    }
  }
}

function validateScroll(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}

/** Converts CRLF and legacy bare-CR input to the one internal LF form. */
export function toCanonicalText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Detects the dominant disk line ending. A tie follows the first observed line
 * ending; text without a line ending uses the supplied fallback.
 */
export function detectDiskLineEnding(text: string, fallback: DiskLineEnding = 'lf'): DiskLineEnding {
  validateLineEnding(fallback);

  let crlfCount = 0;
  let lfCount = 0;
  let first: DiskLineEnding | undefined;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\r' && text[index + 1] === '\n') {
      crlfCount += 1;
      first ??= 'crlf';
      index += 1;
    } else if (text[index] === '\n' || text[index] === '\r') {
      lfCount += 1;
      first ??= 'lf';
    }
  }

  if (crlfCount === 0 && lfCount === 0) return fallback;
  if (crlfCount === lfCount) return first ?? fallback;
  return crlfCount > lfCount ? 'crlf' : 'lf';
}

/** Serializes already-canonical text using the document's disk convention. */
export function toDiskText(text: string, lineEnding: DiskLineEnding): string {
  validateLineEnding(lineEnding);
  const canonical = toCanonicalText(text);
  return lineEnding === 'crlf' ? canonical.replace(/\n/g, '\r\n') : canonical;
}

/**
 * A single authoritative text state shared by all editor presentations.
 * Editor components may keep their native transient view state/history, but
 * every semantic text update must enter through this object.
 */
export class CanonicalDocument {
  private canonicalText: string;
  private diskLineEnding: DiskLineEnding;
  private currentRevision = 0;
  private saved: DocumentSnapshot;
  private staleSaveLatch = false;
  private nextSaveId = 1;
  private readonly pendingSaves = new Map<number, SaveTicket>();
  private readonly undoStack: Array<Pick<DocumentSnapshot, 'text' | 'lineEnding'>> = [];
  private readonly redoStack: Array<Pick<DocumentSnapshot, 'text' | 'lineEnding'>> = [];
  private readonly viewStates: Record<DocumentEditorMode, EditorViewState> = {
    source: copyViewState(EMPTY_VIEW_STATE),
    structured: copyViewState(EMPTY_VIEW_STATE),
  };

  private constructor(text: string, lineEnding: DiskLineEnding, saved: DocumentSnapshot, revision = 0) {
    validateLineEnding(lineEnding);
    this.canonicalText = toCanonicalText(text);
    this.diskLineEnding = lineEnding;
    this.currentRevision = revision;
    this.saved = copySnapshot(saved);
  }

  /** Creates a clean model from bytes already decoded from a disk file. */
  static fromDisk(diskText: string, fallback: DiskLineEnding = 'lf'): CanonicalDocument {
    const lineEnding = detectDiskLineEnding(diskText, fallback);
    const text = toCanonicalText(diskText);
    return new CanonicalDocument(text, lineEnding, { text, lineEnding, revision: 0 });
  }

  /**
   * Creates an unsaved document. Empty new documents start clean; non-empty
   * initial content is dirty relative to the empty new-document snapshot.
   */
  static createNew(initialText = '', lineEnding: DiskLineEnding = 'lf'): CanonicalDocument {
    validateLineEnding(lineEnding);
    const text = toCanonicalText(initialText);
    const revision = text.length > 0 ? 1 : 0;
    return new CanonicalDocument(text, lineEnding, { text: '', lineEnding, revision: 0 }, revision);
  }

  get text(): string {
    return this.canonicalText;
  }

  get lineEnding(): DiskLineEnding {
    return this.diskLineEnding;
  }

  get revision(): number {
    return this.currentRevision;
  }

  get savedSnapshot(): DocumentSnapshot {
    return copySnapshot(this.saved);
  }

  get currentSnapshot(): DocumentSnapshot {
    return {
      text: this.canonicalText,
      lineEnding: this.diskLineEnding,
      revision: this.currentRevision,
    };
  }

  /** True when current serialization differs from disk or a stale save completed. */
  get dirty(): boolean {
    return this.staleSaveLatch || !sameSerializedContent(this.currentSnapshot, this.saved);
  }

  get hasStaleSave(): boolean {
    return this.staleSaveLatch;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get historyUsage(): { undoEntries: number; redoEntries: number; estimatedBytes: number } {
    return {
      undoEntries: this.undoStack.length,
      redoEntries: this.redoStack.length,
      estimatedBytes: [...this.undoStack, ...this.redoStack].reduce(
        (total, snapshot) => total + estimatedHistoryBytes(snapshot),
        0,
      ),
    };
  }

  get serializedText(): string {
    return toDiskText(this.canonicalText, this.diskLineEnding);
  }

  get lastSavedDiskText(): string {
    return toDiskText(this.saved.text, this.saved.lineEnding);
  }

  /** Marks the editor copy as needing an explicit save after a disk conflict. */
  markDiskVersionDiverged(): void {
    this.staleSaveLatch = true;
  }

  setText(text: string): TextUpdateResult {
    const canonical = toCanonicalText(text);
    if (canonical === this.canonicalText) {
      return { changed: false, revision: this.currentRevision, dirty: this.dirty };
    }

    this.recordUndoSnapshot();
    this.canonicalText = canonical;
    this.currentRevision += 1;
    return { changed: true, revision: this.currentRevision, dirty: this.dirty };
  }

  replaceText(start: number, end: number, replacement: string): TextUpdateResult {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.canonicalText.length
    ) {
      throw new RangeError('Replacement range must be within the canonical text.');
    }

    return this.setText(
      `${this.canonicalText.slice(0, start)}${toCanonicalText(replacement)}${this.canonicalText.slice(end)}`,
    );
  }

  setLineEnding(lineEnding: DiskLineEnding): TextUpdateResult {
    validateLineEnding(lineEnding);
    if (lineEnding === this.diskLineEnding) {
      return { changed: false, revision: this.currentRevision, dirty: this.dirty };
    }

    this.recordUndoSnapshot();
    this.diskLineEnding = lineEnding;
    this.currentRevision += 1;
    return { changed: true, revision: this.currentRevision, dirty: this.dirty };
  }

  undo(): TextUpdateResult {
    const previous = this.undoStack.pop();
    if (!previous) return { changed: false, revision: this.currentRevision, dirty: this.dirty };
    this.pushHistory(this.redoStack, { text: this.canonicalText, lineEnding: this.diskLineEnding });
    this.canonicalText = previous.text;
    this.diskLineEnding = previous.lineEnding;
    this.currentRevision += 1;
    return { changed: true, revision: this.currentRevision, dirty: this.dirty };
  }

  redo(): TextUpdateResult {
    const next = this.redoStack.pop();
    if (!next) return { changed: false, revision: this.currentRevision, dirty: this.dirty };
    this.pushHistory(this.undoStack, { text: this.canonicalText, lineEnding: this.diskLineEnding });
    this.canonicalText = next.text;
    this.diskLineEnding = next.lineEnding;
    this.currentRevision += 1;
    return { changed: true, revision: this.currentRevision, dirty: this.dirty };
  }

  getViewState(mode: DocumentEditorMode): EditorViewState {
    return copyViewState(this.viewStates[mode]);
  }

  getViewSnapshot(mode: DocumentEditorMode): EditorViewSnapshot {
    const state = this.viewStates[mode];
    return {
      anchor: state.selection.anchor,
      head: state.selection.head,
      scrollTop: state.scrollTop,
      scrollLeft: state.scrollLeft,
    };
  }

  setViewState(mode: DocumentEditorMode, state: EditorViewState): void {
    validateSelection(state.selection);
    validateScroll('scrollTop', state.scrollTop);
    validateScroll('scrollLeft', state.scrollLeft);
    this.viewStates[mode] = copyViewState(state);
  }

  setViewSnapshot(mode: DocumentEditorMode, snapshot: EditorViewSnapshot): void {
    this.setViewState(mode, {
      selection: { anchor: snapshot.anchor, head: snapshot.head },
      scrollTop: snapshot.scrollTop,
      scrollLeft: snapshot.scrollLeft,
    });
  }

  updateViewState(
    mode: DocumentEditorMode,
    update: Partial<Omit<EditorViewState, 'selection'>> & {
      readonly selection?: EditorSelection;
    },
  ): void {
    const current = this.viewStates[mode];
    this.setViewState(mode, {
      selection: update.selection ?? current.selection,
      scrollTop: update.scrollTop ?? current.scrollTop,
      scrollLeft: update.scrollLeft ?? current.scrollLeft,
    });
  }

  /** Captures an immutable revision-specific payload before asynchronous I/O. */
  beginSave(): SaveTicket {
    const ticket: SaveTicket = Object.freeze({
      id: this.nextSaveId,
      text: this.canonicalText,
      lineEnding: this.diskLineEnding,
      revision: this.currentRevision,
      diskText: this.serializedText,
    });
    this.nextSaveId += 1;
    this.pendingSaves.set(ticket.id, ticket);
    return ticket;
  }

  /**
   * Records a successful filesystem write. Dirty state is only cleared when the
   * document revision is exactly the revision that was written. A stale-save
   * latch also covers the edit-away-then-back race where text equality alone is
   * insufficient to prove that no edits occurred during I/O.
   */
  completeSave(ticket: SaveTicket): SaveCompletion {
    this.consumeSaveTicket(ticket);

    const unchanged = ticket.revision === this.currentRevision;
    this.saved = {
      text: ticket.text,
      lineEnding: ticket.lineEnding,
      revision: ticket.revision,
    };
    this.staleSaveLatch = !unchanged;

    return {
      status: unchanged ? 'saved' : 'stale',
      savedRevision: ticket.revision,
      currentRevision: this.currentRevision,
      dirty: this.dirty,
    };
  }

  /** Removes a failed/cancelled operation without changing the saved snapshot. */
  failSave(ticket: SaveTicket): void {
    this.consumeSaveTicket(ticket);
  }

  /**
   * Replaces editor and saved state with a disk version. Per-mode cursor and
   * scroll state intentionally remain available for the presentation to restore.
   */
  reloadFromDisk(diskText: string, fallback: DiskLineEnding = this.diskLineEnding): void {
    const text = toCanonicalText(diskText);
    const lineEnding = detectDiskLineEnding(diskText, fallback);
    const changed = text !== this.canonicalText || lineEnding !== this.diskLineEnding;
    if (changed) this.currentRevision += 1;
    this.canonicalText = text;
    this.diskLineEnding = lineEnding;
    this.saved = { text, lineEnding, revision: this.currentRevision };
    this.staleSaveLatch = false;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Classifies a watcher result without mutating editor state. */
  classifyExternalChange(diskText: string | null): ExternalChangeClassification {
    if (diskText === null) {
      const hasConflict = this.dirty;
      return {
        kind: hasConflict ? 'deleted-conflict' : 'deleted-clean',
        hasConflict,
        disk: null,
      };
    }

    const disk = {
      text: toCanonicalText(diskText),
      lineEnding: detectDiskLineEnding(diskText, this.saved.lineEnding),
    };
    const sameAsSaved = sameSerializedContent(disk, this.saved);
    if (sameAsSaved) return { kind: 'unchanged', hasConflict: false, disk };

    const sameAsEditor = sameSerializedContent(disk, this.currentSnapshot);
    if (sameAsEditor) return { kind: 'matches-editor', hasConflict: false, disk };

    if (disk.text === this.saved.text && disk.lineEnding !== this.saved.lineEnding) {
      return { kind: 'line-ending-only', hasConflict: false, disk };
    }

    if (!this.dirty) return { kind: 'reload-safe', hasConflict: false, disk };
    return { kind: 'conflict', hasConflict: true, disk };
  }

  private consumeSaveTicket(ticket: SaveTicket): void {
    const pending = this.pendingSaves.get(ticket.id);
    if (pending !== ticket) {
      throw new Error('Save ticket is foreign, already completed, or already failed.');
    }
    this.pendingSaves.delete(ticket.id);
  }

  private recordUndoSnapshot(): void {
    this.pushHistory(this.undoStack, {
      text: this.canonicalText,
      lineEnding: this.diskLineEnding,
    });
    this.redoStack.length = 0;
  }

  private pushHistory(
    stack: Array<Pick<DocumentSnapshot, 'text' | 'lineEnding'>>,
    snapshot: Pick<DocumentSnapshot, 'text' | 'lineEnding'>,
  ): void {
    const incomingBytes = estimatedHistoryBytes(snapshot);
    if (incomingBytes > DOCUMENT_HISTORY_MAX_BYTES) {
      stack.length = 0;
      return;
    }

    stack.push(snapshot);
    let bytes = stack.reduce((total, entry) => total + estimatedHistoryBytes(entry), 0);
    while (
      stack.length > 0 &&
      (stack.length > DOCUMENT_HISTORY_MAX_ENTRIES || bytes > DOCUMENT_HISTORY_MAX_BYTES)
    ) {
      const removed = stack.shift();
      if (removed) bytes -= estimatedHistoryBytes(removed);
    }
  }
}
